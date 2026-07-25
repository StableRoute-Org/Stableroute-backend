/**
 * Security tests for header and log injection via pair path parameters.
 *
 * Verifies that CR / LF / NUL / control characters in :source and
 * :destination path parameters (and body equivalents) are rejected
 * with a 400 invalid_request before they can reach response headers,
 * ETags, JSON bodies, or the structured event log. Also verifies that
 * the reserved `__health` probe prefix is rejected, and that
 * pair.registered / pair.unregistered event payloads only ever
 * contain the sanitized / canonicalized asset codes.
 */

import request from "supertest";
import app from "../index";
import { resetStores, eventLog, pairRegistry, pairKey } from "../stores";

beforeEach(() => resetStores());

/**
 * URL-encode a byte value for injecting into a path segment.
 */
const hex = (byte: number): string => "%" + byte.toString(16).padStart(2, "0");

const CR = hex(0x0d);
const LF = hex(0x0a);
const CRLF = CR + LF;
const NUL = hex(0x00);
const TAB = hex(0x09);
const BS = hex(0x08);
const ESC = hex(0x1b);
const BEL = hex(0x07);

/**
 * All pair routes that accept :source / :destination as Express
 * path parameters. Every one of these must reject control-character
 * injection identically.
 */
const PAIR_PATH_ROUTES: Array<{
  method: "GET" | "DELETE" | "PATCH" | "POST";
  path: string;
  /** Optional body sent along with PATCH / POST routes. */
  body?: unknown;
  /** Expected success status when a legitimate registered pair is used. */
  successStatus: number;
  /** Whether the route requires the pair to already be registered. */
  needsRegistered?: boolean;
}> = [
  {
    method: "GET",
    path: "/api/v1/pairs/:source/:destination",
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "GET",
    path: "/api/v1/pairs/:source/:destination/info",
    successStatus: 200,
    needsRegistered: false,
  },
  {
    method: "DELETE",
    path: "/api/v1/pairs/:source/:destination",
    successStatus: 204,
    needsRegistered: true,
  },
  {
    method: "POST",
    path: "/api/v1/pairs/:source/:destination/reset",
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/liquidity",
    body: { liquidity: "1000000" },
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/min",
    body: { minAmount: "100" },
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/max",
    body: { maxAmount: "1000000" },
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/fee_bps",
    body: { feeBps: 10 },
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/rate",
    body: { rate: "1.0" },
    successStatus: 200,
    needsRegistered: true,
  },
  {
    method: "PATCH",
    path: "/api/v1/pairs/:source/:destination/enabled",
    body: { enabled: false },
    successStatus: 200,
    needsRegistered: true,
  },
];

const makeRequest = (
  agent: request.SuperTest<request.Test>,
  method: string,
  path: string,
  body?: unknown,
): request.Test => {
  let test: request.Test;
  switch (method) {
    case "GET":
      test = agent.get(path);
      break;
    case "DELETE":
      test = agent.delete(path);
      break;
    case "PATCH":
      test = agent.patch(path);
      if (body !== undefined) test = test.send(body);
      break;
    case "POST":
      test = agent.post(path);
      if (body !== undefined) test = test.send(body);
      break;
    default:
      throw new Error(`unknown method ${method}`);
  }
  return test;
};

/**
 * Register a clean pair so the :needsRegistered routes have something
 * to operate on. Uses the request body path (not the URL path) so the
 * injected tests stay isolated from the setup.
 */
const seedPair = async (source = "USDX", destination = "EURX"): Promise<void> => {
  await request(app)
    .post("/api/v1/pairs")
    .send({ source, destination })
    .expect(201);
};

describe("Security – pair path param injection rejection", () => {
  const INJECTION_CASES: Array<{ name: string; payload: string }> = [
    { name: "CR %0D in source", payload: `US${CR}DC` },
    { name: "LF %0A in source", payload: `US${LF}DC` },
    { name: "CRLF %0D%0A in source", payload: `US${CRLF}DC` },
    { name: "NUL %00 in source", payload: `US${NUL}DC` },
    { name: "TAB %09 in source", payload: `US${TAB}DC` },
    { name: "BACKSPACE %08 in source", payload: `US${BS}DC` },
    { name: "ESC %1B in source", payload: `US${ESC}DC` },
    { name: "BEL %07 in source", payload: `US${BEL}DC` },
    { name: "%20 (space) in source", payload: `US${hex(0x20)}DC` },
    { name: "%2E (dot) in source", payload: `US${hex(0x2e)}DC` },
    { name: "CR in destination", payload: `EU${CR}RC` },
    { name: "LF in destination", payload: `EU${LF}RC` },
    { name: "CRLF in destination", payload: `EU${CRLF}RC` },
    { name: "NUL in destination", payload: `EU${NUL}RC` },
    { name: "%20 (space) in destination", payload: `EU${hex(0x20)}RC` },
    { name: "TAB %09 in destination", payload: `EU${TAB}RC` },
  ];

  test.each(PAIR_PATH_ROUTES)(
    "$method $path returns 400 with invalid_request for control chars, never reflecting the payload",
    async (route) => {
      if (route.needsRegistered) await seedPair();

      for (const { name, payload } of INJECTION_CASES) {
        const isSourceInjection = name.toLowerCase().includes("source");
        const source = isSourceInjection ? payload : "USDC";
        const destination = isSourceInjection ? "EURC" : payload;

        const urlPath = route.path
          .replace(":source", source)
          .replace(":destination", destination);

        const res = await makeRequest(request(app), route.method, urlPath, route.body);

        expect(`${name} → status ${res.status}`).toBe(
          `${name} → status 400`,
        );
        expect(res.body.error).toBe("invalid_request");
        expect(res.body.message).toMatch(/source and destination/);
        expect(res.body.requestId).toBeTruthy();

        const raw = JSON.stringify(res.headers) + (res.text ?? "");
        if (payload.includes("%")) {
          expect(raw).not.toContain(decodeURIComponent(payload));
        } else {
          expect(raw).not.toContain(payload);
        }
      }
    },
  );
});

describe("Security – reserved __health prefix rejection", () => {
  test.each(PAIR_PATH_ROUTES)(
    "$method $path returns 400 invalid_request for __health prefix in source",
    async (route) => {
      if (route.needsRegistered) await seedPair();
      const urlPath = route.path
        .replace(":source", "__HEALTH_ASSET")
        .replace(":destination", "EURC");
      const res = await makeRequest(
        request(app),
        route.method,
        urlPath,
        route.body,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    },
  );

  test.each(PAIR_PATH_ROUTES)(
    "$method $path returns 400 invalid_request for __health prefix in destination",
    async (route) => {
      if (route.needsRegistered) await seedPair();
      const urlPath = route.path
        .replace(":source", "USDC")
        .replace(":destination", "__HEALTH_CHECK");
      const res = await makeRequest(
        request(app),
        route.method,
        urlPath,
        route.body,
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    },
  );

  it("POST /api/v1/pairs rejects __health in source body field", async () => {
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "__health_evil", destination: "EURC" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("POST /api/v1/pairs rejects __health in destination body field", async () => {
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "__HEALTH_PROBE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("POST /api/v1/pairs/bulk rejects items with __health source or destination", async () => {
    const res = await request(app).post("/api/v1/pairs/bulk").send({
      pairs: [
        { source: "USDC", destination: "EURC" },
        { source: "__health_a", destination: "EURC" },
        { source: "USDC", destination: "__health_b" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[0].ok).toBe(true);
    expect(res.body.results[1].ok).toBe(false);
    expect(res.body.results[1].error).toBe("invalid_asset_code");
    expect(res.body.results[2].ok).toBe(false);
    expect(res.body.results[2].error).toBe("invalid_asset_code");
  });

  it("GET /api/v1/quote rejects __health in query params", async () => {
    await seedPair("USDC", "EURC");
    const resSrc = await request(app).get("/api/v1/quote").query({
      source_asset: "__HEALTH_A",
      dest_asset: "EURC",
      amount: "100",
    });
    expect(resSrc.status).toBe(400);
    expect(resSrc.body.error).toBe("invalid_request");

    const resDst = await request(app).get("/api/v1/quote").query({
      source_asset: "USDC",
      dest_asset: "__HEALTH_B",
      amount: "100",
    });
    expect(resDst.status).toBe(400);
    expect(resDst.body.error).toBe("invalid_request");
  });
});

describe("Security – header splitting / response injection via path params", () => {
  const INJECT_HEADERS = [
    {
      name: "header-split via CRLF in source",
      source: `US${CRLF}X-Injected-Header:${CRLF}true`,
      destination: "EURC",
    },
    {
      name: "header-split via CRLF in destination",
      source: "USDC",
      destination: `EU${CRLF}X-Injected-Header:${CRLF}true`,
    },
  ];

  test.each(PAIR_PATH_ROUTES)(
    "$method $path does not echo a split header for CRLF path params",
    async (route) => {
      if (route.needsRegistered) await seedPair();
      for (const tc of INJECT_HEADERS) {
        const urlPath = route.path
          .replace(":source", tc.source)
          .replace(":destination", tc.destination);
        const res = await makeRequest(
          request(app),
          route.method,
          urlPath,
          route.body,
        );
        expect(res.status).toBe(400);
        const headerNames = Object.keys(res.headers).map((h) =>
          h.toLowerCase(),
        );
        expect(headerNames).not.toContain("x-injected-header");
        expect(res.headers["x-injected-header"]).toBeUndefined();
        for (const [k, v] of Object.entries(res.headers)) {
          const vs = Array.isArray(v) ? v.join("\n") : String(v ?? "");
          expect(vs).not.toMatch(/\r?\n.*:/);
          expect(k.toLowerCase()).not.toContain("injected");
        }
      }
    },
  );

  it("does not reflect CR/LF bytes into ETag headers via pair registry list", async () => {
    await seedPair();
    const listRes = await request(app).get("/api/v1/pairs");
    expect(listRes.status).toBe(200);
    const etag = listRes.headers.etag ?? "";
    expect(etag).not.toContain("\r");
    expect(etag).not.toContain("\n");
    expect(etag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);
  });
});

describe("Security – event log payload sanitization", () => {
  it("pair.registered event stores only canonicalized uppercase asset codes", async () => {
    expect(eventLog).toHaveLength(0);
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "  usdc  ", destination: "eUrC" });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("USDC");
    expect(res.body.destination).toBe("EURC");

    const registered = eventLog.filter((e) => e.type === "pair.registered");
    expect(registered).toHaveLength(1);
    expect(registered[0].payload.source).toBe("USDC");
    expect(registered[0].payload.destination).toBe("EURC");
  });

  it("pair.registered event never stores control-char payloads via POST /pairs body", async () => {
    const evilSource = `US${String.fromCharCode(0x0d)}${String.fromCharCode(0x0a)}DC`;
    const evilDest = `EU${String.fromCharCode(0x00)}RC`;
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: evilSource, destination: evilDest });
    expect(res.status).toBe(400);
    const matching = eventLog.filter((e) => e.type.startsWith("pair."));
    expect(matching).toHaveLength(0);
  });

  it("pair.unregistered event stores only the sanitized asset codes from path params", async () => {
    await seedPair("USDX", "EURX");
    eventLog.length = 0;
    const res = await request(app).delete("/api/v1/pairs/USDX/EURX");
    expect(res.status).toBe(204);
    const unregistered = eventLog.filter((e) => e.type === "pair.unregistered");
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0].payload.source).toBe("USDX");
    expect(unregistered[0].payload.destination).toBe("EURX");
  });

  it("pair.meta.reset / pair.enabled / pair.disabled events only carry sanitized codes", async () => {
    await seedPair("AB1", "CD2");
    eventLog.length = 0;

    const enabledRes = await request(app)
      .patch("/api/v1/pairs/AB1/CD2/enabled")
      .send({ enabled: false });
    expect(enabledRes.status).toBe(200);
    const disabled = eventLog.find((e) => e.type === "pair.disabled");
    expect(disabled?.payload.source).toBe("AB1");
    expect(disabled?.payload.destination).toBe("CD2");

    const resetRes = await request(app).post("/api/v1/pairs/AB1/CD2/reset");
    expect(resetRes.status).toBe(200);
    const reset = eventLog.find((e) => e.type === "pair.meta.reset");
    expect(reset?.payload.source).toBe("AB1");
    expect(reset?.payload.destination).toBe("CD2");

    const reenableRes = await request(app)
      .patch("/api/v1/pairs/AB1/CD2/enabled")
      .send({ enabled: true });
    expect(reenableRes.status).toBe(200);
    const enabled = eventLog.find((e) => e.type === "pair.enabled");
    expect(enabled?.payload.source).toBe("AB1");
    expect(enabled?.payload.destination).toBe("CD2");
  });

  it("DELETE with injection payload records NO pair.unregistered event (rejected first)", async () => {
    await seedPair("SAFE", "SAFE2");
    eventLog.length = 0;
    const res = await request(app).delete(
      `/api/v1/pairs/SA${CR}FE/SAFE2`,
    );
    expect(res.status).toBe(400);
    expect(eventLog.filter((e) => e.type === "pair.unregistered")).toHaveLength(
      0,
    );
  });
});

describe("Security – pair registry integrity (no injected keys stored)", () => {
  it("POST /api/v1/pairs with injected body never pollutes pairRegistry", async () => {
    const injectSource = `US${String.fromCharCode(10)}DC`;
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: injectSource, destination: "EURC" });
    const allKeys = Array.from(pairRegistry);
    expect(allKeys).toHaveLength(0);
  });

  it("registered pair keys always contain only [A-Z0-9]::[A-Z0-9]", async () => {
    const legitimate = [
      ["USDC", "EURC"],
      ["XLM", "USDX"],
      ["A1", "B2"],
    ];
    for (const [s, d] of legitimate) {
      await request(app).post("/api/v1/pairs").send({ source: s, destination: d }).expect(201);
    }
    for (const k of pairRegistry) {
      expect(k).toMatch(/^[A-Z0-9]{1,12}::[A-Z0-9]{1,12}$/);
    }
    const key = pairKey("USDC", "EURC");
    expect(pairRegistry.has(key)).toBe(true);
  });

  it("asset codes over 12 characters are rejected (boundary)", async () => {
    const tooLongSrc = "A".repeat(13);
    const tooLongDst = "B".repeat(13);
    const resSrc = await request(app)
      .get(`/api/v1/pairs/${tooLongSrc}/EURC/info`);
    expect(resSrc.status).toBe(400);
    const resDst = await request(app)
      .get(`/api/v1/pairs/USDC/${tooLongDst}/info`);
    expect(resDst.status).toBe(400);

    const bodyRes = await request(app)
      .post("/api/v1/pairs")
      .send({ source: tooLongSrc, destination: "EURC" });
    expect(bodyRes.status).toBe(400);
  });

  it("empty asset codes (trimmable to empty) are rejected", async () => {
    const emptySrc = "   ";
    const res = await request(app).get(`/api/v1/pairs/${encodeURIComponent(emptySrc)}/EURC/info`);
    expect(res.status).toBe(400);
    const bodyRes = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "   ", destination: "EURC" });
    expect(bodyRes.status).toBe(400);
  });
});

describe("Security – query param quote asset injection", () => {
  beforeEach(() => seedPair("USDC", "EURC"));

  const QUOTE_INJECTIONS: Array<[string, string, string]> = [
    ["source_asset", `US${CR}DC`, "EURC"],
    ["source_asset", `US${LF}DC`, "EURC"],
    ["source_asset", `US${NUL}DC`, "EURC"],
    ["source_asset", "__HEALTH", "EURC"],
    ["dest_asset", "USDC", `EU${CR}RC`],
    ["dest_asset", "USDC", `EU${LF}RC`],
    ["dest_asset", "USDC", `EU${NUL}RC`],
    ["dest_asset", "USDC", "__HEALTH"],
  ];

  test.each(QUOTE_INJECTIONS)(
    "GET /api/v1/quote returns 400 when %s contains %s (no log pollution)",
    async (key, badValue, otherValue) => {
      const q: Record<string, string> = { amount: "100" };
      q[key] = badValue;
      q[key === "source_asset" ? "dest_asset" : "source_asset"] = otherValue;
      const before = eventLog.length;
      const res = await request(app).get("/api/v1/quote").query(q);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(eventLog.length).toBe(before);
    },
  );

  test.each(QUOTE_INJECTIONS)(
    "GET /api/v1/quote/reverse returns 400 when %s contains %s",
    async (key, badValue, otherValue) => {
      const q: Record<string, string> = { target_amount: "100" };
      q[key] = badValue;
      q[key === "source_asset" ? "dest_asset" : "source_asset"] = otherValue;
      const res = await request(app).get("/api/v1/quote/reverse").query(q);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    },
  );
});

describe("Security – additional path edge cases (non-400 rejections are still safe)", () => {
  it("%2F (URL-encoded slash) inside path param source returns 400 or 404 — never 2xx with reflected payload", async () => {
    const slash = hex(0x2f);
    const url = `/api/v1/pairs/US${slash}DC/EURC/info`;
    const res = await request(app).get(url);
    expect([400, 404]).toContain(res.status);
    const raw = (res.text ?? "") + JSON.stringify(res.headers);
    expect(raw).not.toContain("US/DC");
  });

  it("GET /api/v1/pairs/:source/:destination/info canonicalizes lowercase input to uppercase", async () => {
    await seedPair("USDC", "EURC");
    const res = await request(app).get("/api/v1/pairs/usdc/eurch/info");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("USDC");
    expect(res.body.destination).toBe("EURCH");
  });

  it("lowercase path params still trigger injection validation (after canonicalization)", async () => {
    const res = await request(app).get(
      `/api/v1/pairs/us${CR}dc/EURC/info`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});
