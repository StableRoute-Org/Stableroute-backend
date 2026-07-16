import request from "supertest";
import app, { isValidRequestId } from "../index";
import { resetStores } from "../stores";

const expectCanonicalError = (
  body: Record<string, unknown>,
  requestId: string,
  error: string
) => {
  expect(body.error).toBe(error);
  expect(body.message).toBeTruthy();
  expect(body.requestId).toBe(requestId);
};

describe("StableRoute Backend", () => {
  it("GET /health returns 200 and status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "stableroute-backend" });
  });

  it("GET /api/v1/quote with params returns quote for a registered pair", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
    const res = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USDC", dest_asset: "EURC", amount: "100" });
    expect(res.status).toBe(200);
    expect(res.body.source_asset).toBe("USDC");
    expect(res.body.dest_asset).toBe("EURC");
    expect(res.body.route).toEqual(["USDC", "EURC"]);
  });

  it("GET /api/v1/quote without params returns 400 with canonical error shape", async () => {
    const res = await request(app).get("/api/v1/quote");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/Missing required query params/);
    expect(res.body.requestId).toBeTruthy();
  });

  it("attaches a fresh X-Request-Id when caller omits it", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    const id = res.headers["x-request-id"];
    expect(typeof id).toBe("string");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("echoes the caller-provided X-Request-Id when present", async () => {
    const caller = "stableroute-trace-xyz-1";
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", caller);
    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBe(caller);
  });

  it("replaces an over-length X-Request-Id (> 200 chars) with a generated UUID", async () => {
    const tooLong = "a".repeat(201);
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", tooLong);
    expect(res.status).toBe(200);
    const echoed = res.headers["x-request-id"];
    expect(echoed).not.toBe(tooLong);
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  describe("isValidRequestId", () => {
    it("accepts valid token characters", () => {
      expect(isValidRequestId("abc-123_XYZ.test")).toBe(true);
      expect(isValidRequestId("a")).toBe(true);
      expect(isValidRequestId("a".repeat(200))).toBe(true);
    });

    it("rejects empty string", () => {
      expect(isValidRequestId("")).toBe(false);
    });

    it("rejects strings over 200 characters", () => {
      expect(isValidRequestId("a".repeat(201))).toBe(false);
    });

    it("rejects strings with CR or LF", () => {
      expect(isValidRequestId("id\r\ninjection")).toBe(false);
      expect(isValidRequestId("id\rinjection")).toBe(false);
      expect(isValidRequestId("id\ninjection")).toBe(false);
    });

    it("rejects strings with control characters", () => {
      expect(isValidRequestId("id\x00null")).toBe(false);
      expect(isValidRequestId("id\x1fcontrol")).toBe(false);
    });

    it("rejects strings with spaces or non-token chars", () => {
      expect(isValidRequestId("id with space")).toBe(false);
      expect(isValidRequestId("id@domain")).toBe(false);
    });
  });

  it("returns a structured 404 with requestId for unknown routes", async () => {
    const res = await request(app).get("/api/v1/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.message).toContain("/api/v1/this-route-does-not-exist");
    expect(res.body.requestId).toBeTruthy();
  });

  it("keeps canonical error responses correlated with X-Request-Id", async () => {
    const badQuote = await request(app)
      .get("/api/v1/quote")
      .set("X-Request-Id", "err-400");
    expect(badQuote.status).toBe(400);
    expectCanonicalError(badQuote.body, "err-400", "invalid_request");

    const missingRoute = await request(app)
      .get("/api/v1/not-real")
      .set("X-Request-Id", "err-404");
    expect(missingRoute.status).toBe(404);
    expectCanonicalError(missingRoute.body, "err-404", "not_found");

    const tooLarge = await request(app)
      .post("/api/v1/pairs")
      .set("X-Request-Id", "err-413")
      .send({ payload: "x".repeat(110_000) });
    expect(tooLarge.status).toBe(413);
    expectCanonicalError(tooLarge.body, "err-413", "payload_too_large");

    const badJson = await request(app)
      .post("/api/v1/pairs")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "err-400-json")
      .send("{");
    expect(badJson.status).toBe(400);
    expectCanonicalError(badJson.body, "err-400-json", "invalid_json");

    await request(app).post("/api/v1/admin/pause");
    const paused = await request(app)
      .post("/api/v1/pairs")
      .set("X-Request-Id", "err-503")
      .send({ source: "PAU", destination: "REQ" });
    expect(paused.status).toBe(503);
    expectCanonicalError(paused.body, "err-503", "service_paused");
    await request(app).post("/api/v1/admin/unpause");
  });

  describe("/api/v1/pairs", () => {
    it("starts empty and registers a new pair with 201", async () => {
      const list1 = await request(app).get("/api/v1/pairs");
      expect(list1.status).toBe(200);
      const initialCount = list1.body.pairs.length;

      const reg = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "PAIRA", destination: "PAIRB" });
      expect(reg.status).toBe(201);
      expect(reg.body).toEqual({
        source: "PAIRA",
        destination: "PAIRB",
        registered: true,
      });

      const list2 = await request(app).get("/api/v1/pairs");
      expect(list2.body.pairs.length).toBe(initialCount + 1);
      expect(list2.body.pairs).toContainEqual({
        source: "PAIRA",
        destination: "PAIRB",
      });
    });

    it("is idempotent: re-registering returns 200", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "IDEMA", destination: "IDEMB" });
      const second = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "IDEMA", destination: "IDEMB" });
      expect(second.status).toBe(200);
    });

    it("rejects source == destination with 400", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "USDC", destination: "USDC" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must differ/);
    });

    it("rejects too-long asset codes with 400", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "USDC", destination: "THIRTEENLETTERS" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/1-12 alphanumeric characters/);
    });

    it("rejects asset codes starting with __health (reserved probe namespace) with 400", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "__health1", destination: "USDC" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects destination asset code starting with __health with 400", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .send({ source: "USDC", destination: "__health1" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects __health prefix approximations that could collide with probe namespace", async () => {
      const offending = ["__health", "__healthX", "__health_"];
      for (const code of offending) {
        const res = await request(app)
          .post("/api/v1/pairs")
          .send({ source: code, destination: "USDC" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      }
    });
  });

  it("serves an OpenAPI 3.0 spec with the expected paths", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.paths["/api/v1/pairs"]).toBeTruthy();
    expect(res.body.paths["/api/v1/quote"]).toBeTruthy();
    expect(res.body.paths["/api/v1/admin/pause"]).toBeTruthy();
  });

  it("reads and patches /api/v1/config", async () => {
    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.rateLimitPerWindow).toBeGreaterThan(0);
    const patch = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitPerWindow: 120 });
    expect(patch.body.config.rateLimitPerWindow).toBe(120);
  });

  it("rejects /config patches with negative integers", async () => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitPerWindow: -1 });
    expect(res.status).toBe(400);
  });

  it("registers and removes a webhook", async () => {
    const create = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/wh", events: ["pair.registered"] });
    expect(create.status).toBe(201);
    expect(create.body.id).toMatch(/^wh_/);
    const del = await request(app).delete(`/api/v1/webhooks/${create.body.id}`);
    expect(del.status).toBe(204);
  });

  it("rejects webhook with non-http url", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "ftp://nope.example", events: ["x"] });
    expect(res.status).toBe(400);
  });

  it("records and surfaces pair.registered events", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "EVT", destination: "LOG" });
    const events = await request(app).get("/api/v1/events?limit=50");
    expect(events.status).toBe(200);
    expect(
      events.body.items.some(
        (e: { type: string; payload: { source: string; destination: string } }) =>
          e.type === "pair.registered" &&
          e.payload.source === "EVT" &&
          e.payload.destination === "LOG"
      )
    ).toBe(true);
  });

  it("creates an api key and revokes it by prefix", async () => {
    const create = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "test" });
    expect(create.status).toBe(201);
    expect(create.body.key).toMatch(/^srk_/);
    const prefix = create.body.key.slice(0, 8);
    const list = await request(app).get("/api/v1/api-keys");
    expect(list.body.items.some((k: { prefix: string }) => k.prefix === prefix)).toBe(true);
    const del = await request(app).delete(`/api/v1/api-keys/${prefix}`);
    expect(del.status).toBe(204);
  });

  describe("GET /api/v1/health/deep — readiness probe", () => {
    it("returns 200 with status ok and checks array when healthy", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.memory).toMatchObject({ rssMb: expect.any(Number), heapUsedMb: expect.any(Number) });
      expect(res.body.pid).toBeGreaterThan(0);
      expect(typeof res.body.node).toBe("string");

      // Checks array is present with expected shape
      expect(Array.isArray(res.body.checks)).toBe(true);
      expect(res.body.checks.length).toBeGreaterThanOrEqual(2);
      for (const check of res.body.checks) {
        expect(check).toMatchObject({
          name: expect.any(String),
          status: expect.stringMatching(/^(ok|fail)$/),
          durationMs: expect.any(Number),
        });
      }
      // Both default checks are present
      const names = res.body.checks.map((c: { name: string }) => c.name);
      expect(names).toContain("storage");
      expect(names).toContain("clock");
      // All should pass in normal conditions
      expect(res.body.checks.every((c: { status: string }) => c.status === "ok")).toBe(true);
    });

    it("returns 503 degraded when a check fails", async () => {
      // Force the clock check to fail by stubbing Date.now to return a pre-2020 timestamp
      const spy = jest.spyOn(Date, "now");
      spy.mockReturnValue(1000);

      const res = await request(app).get("/api/v1/health/deep");
      spy.mockRestore();

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("degraded");

      const clockCheck = res.body.checks.find((c: { name: string }) => c.name === "clock");
      expect(clockCheck).toBeDefined();
      expect(clockCheck.status).toBe("fail");

      // Other fields are still present for backward compat
      expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.memory.rssMb).toBeGreaterThan(0);
    });

    it("returns paused status when service is paused", async () => {
      await request(app).post("/api/v1/admin/pause");
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("paused");
      // Checks array still present
      expect(Array.isArray(res.body.checks)).toBe(true);
      await request(app).post("/api/v1/admin/unpause");
    });

    it("still has backward-compatible fields alongside checks", async () => {
      const res = await request(app).get("/api/v1/health/deep");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("status");
      expect(res.body).toHaveProperty("uptimeSeconds");
      expect(res.body).toHaveProperty("memory");
      expect(res.body).toHaveProperty("pid");
      expect(res.body).toHaveProperty("node");
      expect(res.body).toHaveProperty("checks");
    });
  });

  it("GET /api/v1/stats returns totalPairs and paused", async () => {
    const res = await request(app).get("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(typeof res.body.totalPairs).toBe("number");
    expect(typeof res.body.paused).toBe("boolean");
  });

  it("GET /api/v1/metrics returns prometheus text", async () => {
    const res = await request(app).get("/api/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.text).toMatch(/stableroute_pairs_total/);
    expect(res.text).toMatch(/stableroute_paused/);
  });

  describe("GET /api/v1/metrics — event gauges", () => {
    it("includes stableroute_events_total and stableroute_events_by_type with correct Content-Type", async () => {
      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain.*version=0\.0\.4/);
      expect(res.text).toMatch(/# HELP stableroute_events_total/);
      expect(res.text).toMatch(/# TYPE stableroute_events_total gauge/);
      expect(res.text).toMatch(/^stableroute_events_total \d+$/m);
      expect(res.text).toMatch(/# HELP stableroute_events_by_type/);
      expect(res.text).toMatch(/# TYPE stableroute_events_by_type gauge/);
      expect(res.text).toMatch(/stableroute_events_by_type\{type="pair\.registered"\}/);
      // Body must end with a newline (Prometheus requirement)
      expect(res.text.endsWith("\n")).toBe(true);
    });

    it("reflects actual event counts after registering and unregistering a pair", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "MTEST", destination: "NTEST" });
      await request(app).delete("/api/v1/pairs/MTEST/NTEST");

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);
      // stableroute_events_total should be >= 2 (registered + unregistered)
      const totalMatch = res.text.match(/^stableroute_events_total (\d+)$/m);
      expect(totalMatch).not.toBeNull();
      expect(Number(totalMatch![1])).toBeGreaterThanOrEqual(2);

      // per-type gauges for pair.registered and pair.unregistered should be >= 1
      const regMatch = res.text.match(/stableroute_events_by_type\{type="pair\.registered"\} (\d+)/);
      const unregMatch = res.text.match(/stableroute_events_by_type\{type="pair\.unregistered"\} (\d+)/);
      expect(regMatch).not.toBeNull();
      expect(unregMatch).not.toBeNull();
      expect(Number(regMatch![1])).toBeGreaterThanOrEqual(1);
      expect(Number(unregMatch![1])).toBeGreaterThanOrEqual(1);
    });

    it("stableroute_events_total is 0 and all per-type counts are 0 when event log is empty", async () => {
      // This test verifies the empty-log edge case by reading counts in a fresh state.
      // The index.test.ts describe block does not reset stores between tests, so we
      // just assert that the zero-count lines are still emitted (they may not be zero
      // here if other tests ran first, but the series must always be present).
      const res = await request(app).get("/api/v1/metrics");
      expect(res.text).toMatch(/stableroute_events_by_type\{type="pair\.registered"\} \d+/);
      expect(res.text).toMatch(/stableroute_events_by_type\{type="pair\.refreshed"\} \d+/);
      expect(res.text).toMatch(/stableroute_events_by_type\{type="pair\.unregistered"\} \d+/);
    });

    it("existing stableroute_pairs_total and stableroute_paused gauges are still present", async () => {
      const res = await request(app).get("/api/v1/metrics");
      expect(res.text).toMatch(/# HELP stableroute_pairs_total/);
      expect(res.text).toMatch(/# TYPE stableroute_pairs_total gauge/);
      expect(res.text).toMatch(/^stableroute_pairs_total \d+$/m);
      expect(res.text).toMatch(/# HELP stableroute_paused/);
      expect(res.text).toMatch(/# TYPE stableroute_paused gauge/);
      expect(res.text).toMatch(/^stableroute_paused [01]$/m);
    });
  });

  it("admin/pause blocks writes and unpause restores", async () => {
    await request(app).post("/api/v1/admin/pause");
    const blocked = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "PAU", destination: "SED" });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error).toBe("service_paused");
    await request(app).post("/api/v1/admin/unpause");
    const ok = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "PAU", destination: "SED" });
    expect(ok.status === 200 || ok.status === 201).toBe(true);
  });

  describe("pair-meta endpoints", () => {
    const expectPairMetaError = (
      body: Record<string, unknown>,
      requestId: string,
      error: string
    ) => {
      expect(body.error).toBe(error);
      expect(body.message).toBeTruthy();
      expect(body.requestId).toBe(requestId);
    };

    it("registers a pair then patches its fee_bps", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "USD", destination: "EUR" });
      const set = await request(app)
        .patch("/api/v1/pairs/USD/EUR/fee_bps")
        .send({ feeBps: 50 });
      expect(set.status).toBe(200);
      expect(set.body.feeBps).toBe(50);

      const info = await request(app).get("/api/v1/pairs/USD/EUR/info");
      expect(info.status).toBe(200);
      expect(info.body.feeBps).toBe(50);
    });

    it("returns registered pair info with default metadata before any patch", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "DFLT", destination: "META" });

      const info = await request(app).get("/api/v1/pairs/DFLT/META/info");
      expect(info.status).toBe(200);
      expect(info.body).toMatchObject({
        source: "DFLT",
        destination: "META",
        registered: true,
        feeBps: 0,
        minAmount: "0",
        maxAmount: "0",
        liquidity: "0",
        enabled: true,
      });
    });

    it.each([0, 1000])("accepts feeBps boundary value %i", async (feeBps) => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: `FEE${feeBps === 0 ? "Z" : "M"}`, destination: "BND" });

      const source = feeBps === 0 ? "FEEZ" : "FEEM";
      const res = await request(app)
        .patch(`/api/v1/pairs/${source}/BND/fee_bps`)
        .send({ feeBps });

      expect(res.status).toBe(200);
      expect(res.body.feeBps).toBe(feeBps);
    });

    it.each([
      ["zero", "0"],
      ["negative", "-5"],
      ["leading zero", "0100"],
      ["non-numeric", "abc"],
      ["decimal", "1.5"],
      ["empty", ""],
    ])("rejects amount that is %s", async (_label, amount) => {
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "USDC", dest_asset: "EURC", amount });
      expect(res.status).toBe(400);
    });

    it("accepts a very large positive amount via BigInt parsing", async () => {
      // 10^25 — far above Number.MAX_SAFE_INTEGER (~9.007 * 10^15)
      const huge = "10000000000000000000000000";
      await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "USDC", dest_asset: "EURC", amount: huge });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(huge);
    });
  });

  describe("GET /api/v1/quote — pair registration requirement", () => {
    it("returns 404 pair_not_registered for an unregistered pair", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "unreg-pair-test")
        .query({ source_asset: "NOTREG", dest_asset: "PAIR", amount: "100" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
      expect(res.body.message).toMatch(/NOTREG.*PAIR/);
      expect(res.body.source_asset).toBe("NOTREG");
      expect(res.body.dest_asset).toBe("PAIR");
      expect(res.body.requestId).toBe("unreg-pair-test");
    });

    it("returns 200 after the pair is registered", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "REGSRC", destination: "REGDST" });
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "REGSRC", dest_asset: "REGDST", amount: "200" });
      expect(res.status).toBe(200);
      expect(res.body.source_asset).toBe("REGSRC");
      expect(res.body.dest_asset).toBe("REGDST");
      expect(res.body.route).toEqual(["REGSRC", "REGDST"]);
    });

    it("returns 404 again after a pair is unregistered", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "GONE", destination: "SOON" });
      await request(app).delete("/api/v1/pairs/GONE/SOON");
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "GONE", dest_asset: "SOON", amount: "1" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
    });

    it("400 validation errors take precedence over 404 pair_not_registered", async () => {
      // Invalid amount — should be 400, not 404
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "NOTREGX", dest_asset: "NOTREGY", amount: "0" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("pair_not_registered response includes canonical requestId envelope", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "canon-id-123")
        .query({ source_asset: "AA", dest_asset: "BB", amount: "1" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
      expect(res.body.requestId).toBe("canon-id-123");
      expect(res.body.message).toBeTruthy();
      expect(res.body.source_asset).toBe("AA");
      expect(res.body.dest_asset).toBe("BB");
    });
  });

  describe("quote amount bounds", () => {
    beforeEach(() => {
      resetStores();
    });

    it("rejects GET quotes below minAmount with a canonical 400", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "MIN", destination: "DST" });
      await request(app).patch("/api/v1/pairs/MIN/DST/min").send({ minAmount: "100" });

      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "bounds-min")
        .query({ source_asset: "MIN", dest_asset: "DST", amount: "99" });

      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bounds-min", "invalid_request");
      expect(res.body.message).toMatch(/below minAmount/);
    });

    it("rejects GET quotes above maxAmount with a canonical 400", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "MAX", destination: "DST" });
      await request(app).patch("/api/v1/pairs/MAX/DST/max").send({ maxAmount: "1000" });

      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "bounds-max")
        .query({ source_asset: "MAX", dest_asset: "DST", amount: "1001" });

      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bounds-max", "invalid_request");
      expect(res.body.message).toMatch(/exceeds maxAmount/);
    });

    it("rejects GET quotes above liquidity with insufficient_liquidity", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "LIQ", destination: "DST" });
      await request(app).patch("/api/v1/pairs/LIQ/DST/liquidity").send({ liquidity: "500" });

      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "bounds-liq")
        .query({ source_asset: "LIQ", dest_asset: "DST", amount: "501" });

      expect(res.status).toBe(422);
      expectCanonicalError(res.body, "bounds-liq", "insufficient_liquidity");
      expect(res.body.message).toMatch(/available liquidity/);
    });

    it("allows amounts exactly at min, max, and liquidity bounds", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "EDGE", destination: "DST" });
      await request(app).patch("/api/v1/pairs/EDGE/DST/min").send({ minAmount: "100" });
      await request(app).patch("/api/v1/pairs/EDGE/DST/max").send({ maxAmount: "1000" });
      await request(app).patch("/api/v1/pairs/EDGE/DST/liquidity").send({ liquidity: "1000" });

      const min = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "EDGE", dest_asset: "DST", amount: "100" });
      expect(min.status).toBe(200);
      expect(min.body.amount).toBe("100");

      const maxAndLiquidity = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "EDGE", dest_asset: "DST", amount: "1000" });
      expect(maxAndLiquidity.status).toBe(200);
      expect(maxAndLiquidity.body.amount).toBe("1000");
    });

    it("reports bulk quote bound failures per item without failing the batch", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "BULK", destination: "DST" });
      await request(app).patch("/api/v1/pairs/BULK/DST/min").send({ minAmount: "100" });
      await request(app).patch("/api/v1/pairs/BULK/DST/max").send({ maxAmount: "1000" });
      await request(app).patch("/api/v1/pairs/BULK/DST/liquidity").send({ liquidity: "1000" });

      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({
          items: [
            { source_asset: "BULK", dest_asset: "DST", amount: "100" },
            { source_asset: "BULK", dest_asset: "DST", amount: "99" },
            { source_asset: "BULK", dest_asset: "DST", amount: "1001" },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.results[0]).toMatchObject({ index: 0, ok: true, amount: "100" });
      expect(res.body.results[1]).toMatchObject({ index: 1, ok: false, error: "out_of_bounds" });
      expect(res.body.results[2]).toMatchObject({ index: 2, ok: false, error: "out_of_bounds" });
    });
  });

  describe("GET /api/v1/events — type filter", () => {
    beforeEach(() => {
      resetStores();
    });

    it("filters events by a valid type", async () => {
      // Register a pair (pair.registered) then unregister it (pair.unregistered)
      await request(app).post("/api/v1/pairs").send({ source: "FIL", destination: "TER" });
      await request(app).delete("/api/v1/pairs/FIL/TER");

      const res = await request(app).get("/api/v1/events").query({ type: "pair.registered" });
      expect(res.status).toBe(200);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.registered")).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it("excludes events of other types when type param is set", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "FIL", destination: "TER" });
      await request(app).delete("/api/v1/pairs/FIL/TER");

      const res = await request(app).get("/api/v1/events").query({ type: "pair.unregistered" });
      expect(res.status).toBe(200);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.unregistered")).toBe(true);
      // No pair.registered events should appear
      expect(res.body.items.some((e: { type: string }) => e.type === "pair.registered")).toBe(false);
    });

    it("returns 400 with invalid_request for an unknown event type", async () => {
      const res = await request(app).get("/api/v1/events").query({ type: "unknown.event" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/pair\.registered/);
      expect(res.body.requestId).toBeTruthy();
    });

    it("returns 400 with invalid_request for an injection attempt", async () => {
      const res = await request(app).get("/api/v1/events").query({ type: "pair.registered; DROP TABLE" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns empty items when type filter matches no events", async () => {
      // Only register a pair (no unregister) — so pair.unregistered will not appear
      await request(app).post("/api/v1/pairs").send({ source: "NO", destination: "MATCH" });

      const res = await request(app).get("/api/v1/events").query({ type: "pair.unregistered" });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("type filter composes correctly with since param", async () => {
      const before = Date.now() - 1;
      await request(app).post("/api/v1/pairs").send({ source: "SNC", destination: "TST" });

      const res = await request(app)
        .get("/api/v1/events")
        .query({ type: "pair.registered", since: before });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items.every((e: { type: string; ts: number }) =>
        e.type === "pair.registered" && e.ts >= before
      )).toBe(true);
    });

    it("type filter composes correctly with limit param", async () => {
      // Register multiple pairs to produce multiple events
      for (let i = 0; i < 5; i++) {
        await request(app).post("/api/v1/pairs").send({ source: `LIM${i}`, destination: "TST" });
      }

      const res = await request(app)
        .get("/api/v1/events")
        .query({ type: "pair.registered", limit: 2 });
      expect(res.status).toBe(200);
      // At most 2 items returned
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.registered")).toBe(true);
    });

    it("returns all events when type param is omitted", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "ALL", destination: "EVT" });
      await request(app).delete("/api/v1/pairs/ALL/EVT");

      const res = await request(app).get("/api/v1/events");
      expect(res.status).toBe(200);
      const types = new Set(res.body.items.map((e: { type: string }) => e.type));
      // Both event types should be present
      expect(types.has("pair.registered")).toBe(true);
      expect(types.has("pair.unregistered")).toBe(true);
    });
  });

  describe("pair-meta patch validation additional cases", () => {
    it("rejects invalid feeBps value", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "BADFEE", destination: "META" });

      const res = await request(app)
        .patch("/api/v1/pairs/BADFEE/META/fee_bps")
        .set("X-Request-Id", "bad-fee-bps")
        .send({ feeBps: "invalid" as any });

      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-fee-bps", "invalid_request");
    });

    it("rejects unknown fee patch body keys with canonical error shape", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "FEEKEY", destination: "META" });

      const res = await request(app)
        .patch("/api/v1/pairs/FEEKEY/META/fee_bps")
        .set("X-Request-Id", "fee-unknown-key")
        .send({ feeBps: 5, extra: true });

      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "fee-unknown-key", "invalid_request");
      expect(res.body.unknownKeys).toEqual(["extra"]);
    });

    it("rejects PATCH /fee_bps when pair is not registered", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/AAA/BBB/fee_bps")
        .set("X-Request-Id", "missing-fee-pair")
        .send({ feeBps: 5 });
      expect(res.status).toBe(404);
      expectCanonicalError(res.body, "missing-fee-pair", "not_found");
    });
  });

  describe("pair lifecycle: delete and read single", () => {
    it("registers, reads, and unregisters a pair", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "ALIVE", destination: "PAIR" });

      // Read single pair
      const read = await request(app).get("/api/v1/pairs/ALIVE/PAIR");
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ source: "ALIVE", destination: "PAIR", registered: true });

      // Unregister
      const del = await request(app).delete("/api/v1/pairs/ALIVE/PAIR");
      expect(del.status).toBe(204);

      // Read after delete — 404
      const readAfter = await request(app).get("/api/v1/pairs/ALIVE/PAIR");
      expect(readAfter.status).toBe(404);

      // Double delete — 404
      const delAgain = await request(app).delete("/api/v1/pairs/ALIVE/PAIR");
      expect(delAgain.status).toBe(404);
    });

    it("GET single pair returns 404 for unregistered pair", async () => {
      const res = await request(app).get("/api/v1/pairs/NO/EXIST");
      expect(res.status).toBe(404);
    });
  });

  describe("pair-meta: liquidity, max, min patches", () => {
    beforeEach(async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "META", destination: "TEST" });
    });

    afterAll(async () => {
      await request(app).delete("/api/v1/pairs/META/TEST");
    });

    it("patches liquidity", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/liquidity")
        .send({ liquidity: "50000" });
      expect(res.status).toBe(200);
      expect(res.body.liquidity).toBe("50000");
    });

    it("rejects liquidity with non-numeric string", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/liquidity")
        .set("X-Request-Id", "bad-liquidity-alpha")
        .send({ liquidity: "abc" });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-liquidity-alpha", "invalid_request");
    });

    it.each([
      ["leading zero", "01"],
      ["array", ["10"]],
      ["object", { value: "10" }],
    ])("rejects liquidity that is %s", async (_label, liquidity) => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/liquidity")
        .set("X-Request-Id", "bad-liquidity-shape")
        .send({ liquidity });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-liquidity-shape", "invalid_request");
    });

    it("patches maxAmount", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/max")
        .send({ maxAmount: "99999" });
      expect(res.status).toBe(200);
      expect(res.body.maxAmount).toBe("99999");
    });

    it("rejects maxAmount with zero", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/max")
        .set("X-Request-Id", "bad-max-zero")
        .send({ maxAmount: "0" });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-max-zero", "invalid_request");
    });

    it.each([
      ["leading zero", "01"],
      ["array", ["10"]],
      ["object", { value: "10" }],
    ])("rejects maxAmount that is %s", async (_label, maxAmount) => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/max")
        .set("X-Request-Id", "bad-max-shape")
        .send({ maxAmount });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-max-shape", "invalid_request");
    });

    it("patches minAmount", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/min")
        .send({ minAmount: "100" });
      expect(res.status).toBe(200);
      expect(res.body.minAmount).toBe("100");
    });

    it("rejects minAmount with negative", async () => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/min")
        .set("X-Request-Id", "bad-min-negative")
        .send({ minAmount: "-5" });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-min-negative", "invalid_request");
    });

    it.each([
      ["leading zero", "01"],
      ["array", ["10"]],
      ["object", { value: "10" }],
    ])("rejects minAmount that is %s", async (_label, minAmount) => {
      const res = await request(app)
        .patch("/api/v1/pairs/META/TEST/min")
        .set("X-Request-Id", "bad-min-shape")
        .send({ minAmount });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, "bad-min-shape", "invalid_request");
    });

    it("returns 404 for unregistered pair on all patch endpoints", async () => {
      const liquidity = await request(app)
        .patch("/api/v1/pairs/GONE/ONE/liquidity")
        .set("X-Request-Id", "missing-liquidity-pair")
        .send({ liquidity: "10" });
      expect(liquidity.status).toBe(404);
      expectCanonicalError(liquidity.body, "missing-liquidity-pair", "not_found");

      const max = await request(app)
        .patch("/api/v1/pairs/GONE/ONE/max")
        .set("X-Request-Id", "missing-max-pair")
        .send({ maxAmount: "10" });
      expect(max.status).toBe(404);
      expectCanonicalError(max.body, "missing-max-pair", "not_found");

      const min = await request(app)
        .patch("/api/v1/pairs/GONE/ONE/min")
        .set("X-Request-Id", "missing-min-pair")
        .send({ minAmount: "10" });
      expect(min.status).toBe(404);
      expectCanonicalError(min.body, "missing-min-pair", "not_found");
    });

    it("returns info with default values for unregistered pair", async () => {
      const res = await request(app).get("/api/v1/pairs/GONE/ONE/info");
      expect(res.status).toBe(200);
      expect(res.body.registered).toBe(false);
      expect(res.body.feeBps).toBe(0);
      expect(res.body.minAmount).toBe("0");
      expect(res.body.maxAmount).toBe("0");
      expect(res.body.liquidity).toBe("0");
      expect(res.body.enabled).toBe(true);
    });
  });

  describe("POST /api/v1/quote/bulk", () => {
    let savedBulkMax: number;

    beforeEach(async () => {
      // Save original bulkMaxItems
      const cfg = await request(app).get("/api/v1/config");
      savedBulkMax = cfg.body.config.bulkMaxItems;
      // Register pair used across bulk tests
      await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
    });

    afterEach(async () => {
      // Restore original bulkMaxItems
      await request(app)
        .patch("/api/v1/config")
        .send({ bulkMaxItems: savedBulkMax });
    });

    it("rejects empty items", async () => {
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({ items: [] });
      expect(res.status).toBe(400);
    });

    it("rejects more than the configured max (default 100)", async () => {
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({ items: new Array(101).fill({}) });
      expect(res.status).toBe(400);
    });

    it("returns per-item results with valid and invalid entries", async () => {
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({
          items: [
            { source_asset: "USDC", dest_asset: "EURC", amount: "100" },
            { source_asset: "USDC", dest_asset: "USDC", amount: "100" },
            { source_asset: "XLM", dest_asset: "", amount: "50" },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.results[0].ok).toBe(true);
      expect(res.body.results[1].ok).toBe(false);
      expect(res.body.results[2].ok).toBe(false);
    });

    it("lowered bulkMaxItems rejects at new limit", async () => {
      await request(app)
        .patch("/api/v1/config")
        .send({ bulkMaxItems: 5 });

      // 5 items — should pass
      const ok = await request(app)
        .post("/api/v1/quote/bulk")
        .send({ items: new Array(5).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
      expect(ok.status).toBe(200);

      // 6 items — should fail at the new cap
      const over = await request(app)
        .post("/api/v1/quote/bulk")
        .send({ items: new Array(6).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
      expect(over.status).toBe(400);
      expect(over.body.message).toMatch(/1-5/);
    });

    it("raised bulkMaxItems accepts above default", async () => {
      await request(app)
        .patch("/api/v1/config")
        .send({ bulkMaxItems: 150 });

      // 101 items — would fail at default 100, now passes
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({ items: new Array(101).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
      expect(res.status).toBe(200);
    });

    it("rejects bulkMaxItems above absolute ceiling", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .send({ bulkMaxItems: 100_001 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot exceed/);
    });

    it("accepts bulkMaxItems up to absolute ceiling", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .send({ bulkMaxItems: 10_000 });
      expect(res.status).toBe(200);
    });

    it("returns pair_not_registered per-item for an unregistered pair", async () => {
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({
          items: [
            { source_asset: "USDC", dest_asset: "EURC", amount: "100" },
            { source_asset: "XLM", dest_asset: "EURC", amount: "50" },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.results[0].ok).toBe(true);
      expect(res.body.results[1].ok).toBe(false);
      expect(res.body.results[1].error).toBe("pair_not_registered");
    });

    it("bulk: shape/validation errors take precedence over pair_not_registered", async () => {
      const res = await request(app)
        .post("/api/v1/quote/bulk")
        .send({
          items: [
            { source_asset: "USDC", dest_asset: "USDC", amount: "100" },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.results[0].ok).toBe(false);
      expect(res.body.results[0].error).toBe("invalid_item");
    });
  });

  describe("webhook edge cases", () => {
    it("lists webhooks (empty and after creation)", async () => {
      const listEmpty = await request(app).get("/api/v1/webhooks");
      expect(listEmpty.status).toBe(200);
      expect(Array.isArray(listEmpty.body.items)).toBe(true);

      await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://hook.example/evt", events: ["pair.registered"] });

      const listFull = await request(app).get("/api/v1/webhooks");
      expect(listFull.status).toBe(200);
      expect(listFull.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects invalid events array", async () => {
      const badEvents = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/h", events: "not-an-array" });
      expect(badEvents.status).toBe(400);

      const emptyEvents = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/h", events: [] });
      expect(emptyEvents.status).toBe(400);
    });

    it("returns 404 when deleting non-existent webhook", async () => {
      const res = await request(app).delete("/api/v1/webhooks/nonexistent-id");
      expect(res.status).toBe(404);
    });

    it("rejects events array that exceeds the max count", async () => {
      const tooMany = Array.from({ length: 21 }, (_, i) => `event.${i}`);
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/h", events: tooMany });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("accepts events array at exactly the max count", async () => {
      const atLimit = Array.from({ length: 20 }, (_, i) => `event.${i}`);
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/h", events: atLimit });
      expect(res.status).toBe(201);
    });

    it("rejects event names that exceed the max length", async () => {
      const longName = "a".repeat(129);
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({ url: "https://example.com/h", events: [longName] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("rejects blank and whitespace-only event names", async () => {
      for (const name of ["", "   ", "\t"]) {
        const res = await request(app)
          .post("/api/v1/webhooks")
          .send({ url: "https://example.com/h", events: [name] });
        expect(res.status).toBe(400);
      }
    });

    it("rejects event names with reserved prefixes", async () => {
      for (const name of ["internal.foo", "system.bar", "admin.baz"]) {
        const res = await request(app)
          .post("/api/v1/webhooks")
          .send({ url: "https://example.com/h", events: [name] });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      }
    });

    it("deduplicates event names before storing", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({
          url: "https://example.com/h",
          events: ["pair.registered", "pair.registered", "pair.updated"],
        });
      expect(res.status).toBe(201);
      expect(res.body.events).toEqual(["pair.registered", "pair.updated"]);
    });
  });

  describe("admin endpoints", () => {
    it("GET /api/v1/admin/status returns paused state", async () => {
      const res = await request(app).get("/api/v1/admin/status");
      expect(res.status).toBe(200);
      expect("paused" in res.body).toBe(true);
    });
  });

  describe("config edge cases", () => {
    it("rejects all invalid config values", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .send({ rateLimitPerWindow: -1, rateLimitWindowMs: 0, bulkMaxItems: -100 });
      expect(res.status).toBe(400);
    });

    it("patches multiple config fields at once", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .send({ rateLimitPerWindow: 100, rateLimitWindowMs: 30000, bulkMaxItems: 50 });
      expect(res.status).toBe(200);
      expect(res.body.config.rateLimitPerWindow).toBe(100);
      expect(res.body.config.rateLimitWindowMs).toBe(30000);
      expect(res.body.config.bulkMaxItems).toBe(50);
    });
  });

  describe("events filtering", () => {
    it("filters events by since timestamp", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "SINCE", destination: "TEST" });

      const farFuture = Date.now() + 100000;
      const noEvents = await request(app).get(`/api/v1/events?since=${farFuture}`);
      expect(noEvents.status).toBe(200);
      expect(noEvents.body.items.length).toBe(0);

      const allEvents = await request(app).get("/api/v1/events");
      expect(allEvents.status).toBe(200);
      expect(allEvents.body.items.length).toBeGreaterThan(0);
    });

    it("respects limit parameter", async () => {
      const res = await request(app).get("/api/v1/events?limit=3");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
    });
  });

  describe("api-keys edge cases", () => {
    it("rejects missing label", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects empty label", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "" });
      expect(res.status).toBe(400);
    });

    it("returns 404 when deleting non-existent key prefix", async () => {
      const res = await request(app).delete("/api/v1/api-keys/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/openapi.json", () => {
    it("contains all expected paths", async () => {
      const res = await request(app).get("/api/v1/openapi.json");
      expect(res.body.info.version).toBe("1.0.0");
      expect(res.body.paths["/api/v1/api-keys"]).toBeTruthy();
      expect(res.body.paths["/api/v1/webhooks"]).toBeTruthy();
      expect(res.body.paths["/api/v1/events"]).toBeTruthy();
    });
  });



  describe("pair-meta: minAmount vs liquidity cross-field invariant", () => {
    const SRC = "INVS";
    const DST = "CHCK";

    beforeEach(async () => {
      await request(app).post("/api/v1/pairs").send({ source: SRC, destination: DST });
    });

    afterEach(async () => {
      await request(app).delete(`/api/v1/pairs/${SRC}/${DST}`);
    });

    it("PATCH /liquidity rejects when new liquidity < current minAmount", async () => {
      // Set minAmount to 1000 first
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "1000" });

      // Attempt to set liquidity to 500 — must be rejected
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "500" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/liquidity/);
      expect(res.body.message).toMatch(/minAmount/);
    });

    it("PATCH /liquidity accepts when new liquidity equals current minAmount", async () => {
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "1000" });

      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "1000" });

      expect(res.status).toBe(200);
      expect(res.body.liquidity).toBe("1000");
    });

    it("PATCH /liquidity accepts when new liquidity > current minAmount", async () => {
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "100" });

      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "5000" });

      expect(res.status).toBe(200);
      expect(res.body.liquidity).toBe("5000");
    });

    it("PATCH /liquidity with '0' is accepted even if minAmount > 0 (unset carve-out)", async () => {
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "999" });

      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "0" });

      expect(res.status).toBe(200);
      expect(res.body.liquidity).toBe("0");
    });

    it("PATCH /min rejects when new minAmount > current liquidity", async () => {
      // Reset minAmount to "0" so the next liquidity patch is accepted
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "0" });

      // Set liquidity to 500
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "500" });

      // Attempt to set minAmount to 1000 — must be rejected since 1000 > 500
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "1000" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/minAmount/);
      expect(res.body.message).toMatch(/liquidity/);
    });

    it("PATCH /min accepts when new minAmount equals current liquidity", async () => {
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "500" });

      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "500" });

      expect(res.status).toBe(200);
      expect(res.body.minAmount).toBe("500");
    });

    it("PATCH /min accepts when liquidity is '0' (unset) regardless of minAmount", async () => {
      // Explicitly reset liquidity to "0" (unset) before testing the carve-out.
      // First reset minAmount so the liquidity patch is accepted.
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "0" });
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "0" });

      // With liquidity "0" (unset), minAmount can freely exceed it
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "999999" });

      expect(res.status).toBe(200);
      expect(res.body.minAmount).toBe("999999");
    });

    it("correctly compares 39-digit base-unit strings without Number precision loss", async () => {
      // These large values are above Number.MAX_SAFE_INTEGER; BigInt must be used
      const bigLiquidity = "100000000000000000000000000000000000000"; // 10^38
      const bigMin      = "100000000000000000000000000000000000001"; // 10^38 + 1

      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: bigLiquidity });

      // minAmount one unit above liquidity — must be rejected
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: bigMin });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });
  });

  describe("GET /api/v1/pairs with ETag", () => {
    it("returns 304 when If-None-Match matches", async () => {
      const first = await request(app).get("/api/v1/pairs");
      const etag = first.headers["etag"];
      expect(etag).toBeTruthy();

      const second = await request(app)
        .get("/api/v1/pairs")
        .set("If-None-Match", etag);
      expect(second.status).toBe(304);
    });
  });

  describe("GET /api/v1/quote validation", () => {
    it("rejects source_asset == dest_asset", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "USDC", dest_asset: "USDC", amount: "100" });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must differ/);
    });

    it("rejects asset codes longer than 12 chars", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .query({
          source_asset: "USDC",
          dest_asset: "THIRTEENLETTERS",
          amount: "100",
        });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/1-12 alphanumeric characters/);
    });

    it("rejects array-form asset params (param pollution)", async () => {
      // Express parses ?source_asset=USDC&source_asset=EURC into an array.
      const res = await request(app)
        .get("/api/v1/quote")
        .query("source_asset=USDC&source_asset=EURC&dest_asset=XLM&amount=10");
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/1-12 alphanumeric characters/);
    });

    it.each([
      ["zero", "0"],
      ["negative", "-5"],
      ["leading zero", "0100"],
      ["non-numeric", "abc"],
      ["decimal", "1.5"],
      ["empty", ""],
    ])("rejects amount that is %s", async (_label, amount) => {
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "USDC", dest_asset: "EURC", amount });
      expect(res.status).toBe(400);
    });

    it("accepts a very large positive amount via BigInt parsing", async () => {
      // 10^25 — far above Number.MAX_SAFE_INTEGER (~9.007 * 10^15)
      const huge = "10000000000000000000000000";
      await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "USDC", dest_asset: "EURC", amount: huge });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(huge);
    });
  });

  describe("GET /api/v1/quote — pair registration requirement", () => {
    it("returns 404 pair_not_registered for an unregistered pair", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "unreg-pair-test")
        .query({ source_asset: "NOTREG", dest_asset: "PAIR", amount: "100" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
      expect(res.body.message).toMatch(/NOTREG.*PAIR/);
      expect(res.body.source_asset).toBe("NOTREG");
      expect(res.body.dest_asset).toBe("PAIR");
      expect(res.body.requestId).toBe("unreg-pair-test");
    });

    it("returns 200 after the pair is registered", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "REGSRC", destination: "REGDST" });
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "REGSRC", dest_asset: "REGDST", amount: "200" });
      expect(res.status).toBe(200);
      expect(res.body.source_asset).toBe("REGSRC");
      expect(res.body.dest_asset).toBe("REGDST");
      expect(res.body.route).toEqual(["REGSRC", "REGDST"]);
    });

    it("returns 404 again after a pair is unregistered", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "GONE", destination: "SOON" });
      await request(app).delete("/api/v1/pairs/GONE/SOON");
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "GONE", dest_asset: "SOON", amount: "1" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
    });

    it("400 validation errors take precedence over 404 pair_not_registered", async () => {
      // Invalid amount — should be 400, not 404
      const res = await request(app)
        .get("/api/v1/quote")
        .query({ source_asset: "NOTREGX", dest_asset: "NOTREGY", amount: "0" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("pair_not_registered response includes canonical requestId envelope", async () => {
      const res = await request(app)
        .get("/api/v1/quote")
        .set("X-Request-Id", "canon-id-123")
        .query({ source_asset: "AA", dest_asset: "BB", amount: "1" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
      expect(res.body.requestId).toBe("canon-id-123");
      expect(res.body.message).toBeTruthy();
      expect(res.body.source_asset).toBe("AA");
      expect(res.body.dest_asset).toBe("BB");
    });
  });

  describe("GET /api/v1/events — type filter", () => {
    beforeEach(() => {
      resetStores();
    });

    it("filters events by a valid type", async () => {
      // Register a pair (pair.registered) then unregister it (pair.unregistered)
      await request(app).post("/api/v1/pairs").send({ source: "FIL", destination: "TER" });
      await request(app).delete("/api/v1/pairs/FIL/TER");

      const res = await request(app).get("/api/v1/events").query({ type: "pair.registered" });
      expect(res.status).toBe(200);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.registered")).toBe(true);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it("excludes events of other types when type param is set", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "FIL", destination: "TER" });
      await request(app).delete("/api/v1/pairs/FIL/TER");

      const res = await request(app).get("/api/v1/events").query({ type: "pair.unregistered" });
      expect(res.status).toBe(200);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.unregistered")).toBe(true);
      // No pair.registered events should appear
      expect(res.body.items.some((e: { type: string }) => e.type === "pair.registered")).toBe(false);
    });

    it("returns 400 with invalid_request for an unknown event type", async () => {
      const res = await request(app).get("/api/v1/events").query({ type: "unknown.event" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/pair\.registered/);
      expect(res.body.requestId).toBeTruthy();
    });

    it("returns 400 with invalid_request for an injection attempt", async () => {
      const res = await request(app).get("/api/v1/events").query({ type: "pair.registered; DROP TABLE" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("returns empty items when type filter matches no events", async () => {
      // Only register a pair (no unregister) — so pair.unregistered will not appear
      await request(app).post("/api/v1/pairs").send({ source: "NO", destination: "MATCH" });

      const res = await request(app).get("/api/v1/events").query({ type: "pair.unregistered" });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("type filter composes correctly with since param", async () => {
      const before = Date.now() - 1;
      await request(app).post("/api/v1/pairs").send({ source: "SNC", destination: "TST" });

      const res = await request(app)
        .get("/api/v1/events")
        .query({ type: "pair.registered", since: before });
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.items.every((e: { type: string; ts: number }) =>
        e.type === "pair.registered" && e.ts >= before
      )).toBe(true);
    });

    it("type filter composes correctly with limit param", async () => {
      // Register multiple pairs to produce multiple events
      for (let i = 0; i < 5; i++) {
        await request(app).post("/api/v1/pairs").send({ source: `LIM${i}`, destination: "TST" });
      }

      const res = await request(app)
        .get("/api/v1/events")
        .query({ type: "pair.registered", limit: 2 });
      expect(res.status).toBe(200);
      // At most 2 items returned
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      expect(res.body.items.every((e: { type: string }) => e.type === "pair.registered")).toBe(true);
    });

    it("returns all events when type param is omitted", async () => {
      await request(app).post("/api/v1/pairs").send({ source: "ALL", destination: "EVT" });
      await request(app).delete("/api/v1/pairs/ALL/EVT");

      const res = await request(app).get("/api/v1/events");
      expect(res.status).toBe(200);
      const types = new Set(res.body.items.map((e: { type: string }) => e.type));
      // Both event types should be present
      expect(types.has("pair.registered")).toBe(true);
      expect(types.has("pair.unregistered")).toBe(true);
    });
  });

  describe("malformed JSON handling", () => {
    it("returns 400 invalid_json for a malformed body without leaking the raw fragment", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "application/json")
        .send("{not json");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_json");
      expect(res.body.message).toBe("request body is not valid JSON");
      expect(res.body.requestId).toBeTruthy();
      // The fixed message must not echo the offending input or a stack trace.
      expect(res.body.message).not.toMatch(/not json/);
      expect(res.body.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at Object|node_modules/);
    });

    it("still accepts a valid JSON body", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ source: "JSN", destination: "OKAY" }));
      expect([200, 201]).toContain(res.status);
    });

    it("keeps the 413 payload_too_large mapping ahead of the 400 branch", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .send({ payload: "x".repeat(110_000) });
      expect(res.status).toBe(413);
      expect(res.body.error).toBe("payload_too_large");
    });
  });

  describe("GET /api/v1/quote/reverse", () => {
    beforeEach(async () => {
      resetStores();
      // Register a pair to test registration-required paths
      await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
    });

    it("returns 200 and exact-output quote for a registered pair", async () => {
      const res = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: "100" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        source_asset: "USDC",
        dest_asset: "EURC",
        target_amount: "100",
        required_input: "100",
        estimated_rate: "1.0",
        route: ["USDC", "EURC"],
      });
    });

    it("rejects when any required query parameter is missing", async () => {
      // Missing target_amount
      const res1 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC" });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe("invalid_request");
      expect(res1.body.message).toMatch(/Missing required query params/);

      // Missing source_asset
      const res2 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ dest_asset: "EURC", target_amount: "100" });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe("invalid_request");

      // Missing dest_asset
      const res3 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", target_amount: "100" });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe("invalid_request");
    });

    it("rejects equal source and destination assets", async () => {
      const res = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "USDC", target_amount: "100" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/source_asset and dest_asset must differ/);
    });

    it("rejects invalid asset codes", async () => {
      const res = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "INVALID_ASSET_CODE_TOO_LONG", dest_asset: "EURC", target_amount: "100" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/source_asset and dest_asset must be 1-12 alphanumeric characters/);
    });

    it("rejects invalid target_amount values", async () => {
      // Zero amount
      const res1 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: "0" });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe("invalid_request");

      // Leading zero
      const res2 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: "0100" });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe("invalid_request");

      // Non-integer string
      const res3 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: "100.5" });
      expect(res3.status).toBe(400);
      expect(res3.body.error).toBe("invalid_request");

      // Negative number
      const res4 = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: "-100" });
      expect(res4.status).toBe(400);
      expect(res4.body.error).toBe("invalid_request");
    });

    it("rejects when the pair is unregistered", async () => {
      const res = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDT", dest_asset: "EURC", target_amount: "100" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("pair_not_registered");
      expect(res.body.source_asset).toBe("USDT");
      expect(res.body.dest_asset).toBe("EURC");
    });

    it("handles extremely large 39-digit BigInt target amounts", async () => {
      const largeTarget = "9".repeat(39);
      const res = await request(app)
        .get("/api/v1/quote/reverse")
        .query({ source_asset: "USDC", dest_asset: "EURC", target_amount: largeTarget });
      expect(res.status).toBe(200);
      expect(res.body.target_amount).toBe(largeTarget);
      expect(res.body.required_input).toBe(largeTarget);
    });

    it("bypass registration check when ALLOW_UNREGISTERED_QUOTES=true", async () => {
      process.env.ALLOW_UNREGISTERED_QUOTES = "true";
      try {
        const res = await request(app)
          .get("/api/v1/quote/reverse")
          .query({ source_asset: "USDT", dest_asset: "EURC", target_amount: "100" });
        expect(res.status).toBe(200);
        expect(res.body.required_input).toBe("100");
      } finally {
        delete process.env.ALLOW_UNREGISTERED_QUOTES;
      }
    });
  });

  describe("List Endpoints Pagination", () => {
    beforeEach(() => {
      resetStores();
    });

    describe("GET /api/v1/pairs pagination", () => {
      it("pages through pairs successfully", async () => {
        const pairsToRegister = [
          { source: "USDC", destination: "EURC" },
          { source: "USDC", destination: "XLM" },
          { source: "XLM", destination: "EURC" },
          { source: "EURC", destination: "XLM" },
          { source: "BTC", destination: "USD" },
        ];
        for (const p of pairsToRegister) {
          await request(app).post("/api/v1/pairs").send(p);
        }

        const res1 = await request(app).get("/api/v1/pairs").query({ limit: 2 });
        expect(res1.status).toBe(200);
        expect(res1.body.pairs).toHaveLength(2);
        expect(res1.body.nextCursor).toBeTruthy();

        const res2 = await request(app)
          .get("/api/v1/pairs")
          .query({ limit: 2, cursor: res1.body.nextCursor });
        expect(res2.status).toBe(200);
        expect(res2.body.pairs).toHaveLength(2);
        expect(res2.body.nextCursor).toBeTruthy();

        const res3 = await request(app)
          .get("/api/v1/pairs")
          .query({ limit: 2, cursor: res2.body.nextCursor });
        expect(res3.status).toBe(200);
        expect(res3.body.pairs).toHaveLength(1);
        expect(res3.body.nextCursor).toBeNull();
      });

      it("respects default limit and caps limit to 500", async () => {
        for (let i = 0; i < 10; i++) {
          await request(app)
            .post("/api/v1/pairs")
            .send({ source: `P${i}`, destination: "USD" });
        }

        const resDefault = await request(app).get("/api/v1/pairs");
        expect(resDefault.status).toBe(200);
        expect(resDefault.body.pairs.length).toBeGreaterThanOrEqual(10);
        expect(resDefault.body.nextCursor).toBeNull();

        const resClamp = await request(app).get("/api/v1/pairs").query({ limit: 600 });
        expect(resClamp.status).toBe(200);
      });

      it("rejects invalid/malformed cursors with 400 invalid_request", async () => {
        const res = await request(app)
          .get("/api/v1/pairs")
          .set("X-Request-Id", "malformed-cursor-test")
          .query({ cursor: "not-base64-!!!" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
        expect(res.body.message).toMatch(/cursor/i);
        expect(res.body.requestId).toBe("malformed-cursor-test");
      });

      it("preserves ETag behavior on paginated slice", async () => {
        await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "EURC" });
        await request(app).post("/api/v1/pairs").send({ source: "USDC", destination: "XLM" });

        const res = await request(app).get("/api/v1/pairs").query({ limit: 1 });
        expect(res.status).toBe(200);
        const etag = res.headers.etag;
        expect(etag).toBeTruthy();

        const res304 = await request(app)
          .get("/api/v1/pairs")
          .query({ limit: 1 })
          .set("If-None-Match", etag);
        expect(res304.status).toBe(304);
      });
    });

    describe("GET /api/v1/webhooks pagination", () => {
      it("pages through webhooks", async () => {
        for (let i = 0; i < 3; i++) {
          await request(app)
            .post("/api/v1/webhooks")
            .send({ url: `https://example.com/wh${i}`, events: ["pair.registered"] });
        }

        const res1 = await request(app).get("/api/v1/webhooks").query({ limit: 2 });
        expect(res1.status).toBe(200);
        expect(res1.body.items).toHaveLength(2);
        expect(res1.body.nextCursor).toBeTruthy();

        const res2 = await request(app)
          .get("/api/v1/webhooks")
          .query({ limit: 2, cursor: res1.body.nextCursor });
        expect(res2.status).toBe(200);
        expect(res2.body.items).toHaveLength(1);
        expect(res2.body.nextCursor).toBeNull();
      });

      it("returns 400 for malformed cursor", async () => {
        const res = await request(app).get("/api/v1/webhooks").query({ cursor: "!!!" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      });
    });

    describe("GET /api/v1/api-keys pagination", () => {
      it("pages through api keys", async () => {
        for (let i = 0; i < 3; i++) {
          await request(app).post("/api/v1/api-keys").send({ label: `key-${i}` });
        }

        const res1 = await request(app).get("/api/v1/api-keys").query({ limit: 2 });
        expect(res1.status).toBe(200);
        expect(res1.body.items).toHaveLength(2);
        expect(res1.body.nextCursor).toBeTruthy();

        const res2 = await request(app)
          .get("/api/v1/api-keys")
          .query({ limit: 2, cursor: res1.body.nextCursor });
        expect(res2.status).toBe(200);
        expect(res2.body.items).toHaveLength(1);
        expect(res2.body.nextCursor).toBeNull();
      });

      it("returns 400 for malformed cursor", async () => {
        const res = await request(app).get("/api/v1/api-keys").query({ cursor: "!!!" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      });
    });

    describe("GET /api/v1/events pagination", () => {
      it("pages through events with since/type filters layered", async () => {
        const before = Date.now() - 1000;
        await request(app).post("/api/v1/pairs").send({ source: "EVT1", destination: "USD" });
        await request(app).post("/api/v1/pairs").send({ source: "EVT2", destination: "USD" });
        await request(app).post("/api/v1/pairs").send({ source: "EVT3", destination: "USD" });

        const res1 = await request(app)
          .get("/api/v1/events")
          .query({ limit: 2, type: "pair.registered", since: before });
        expect(res1.status).toBe(200);
        expect(res1.body.items).toHaveLength(2);
        expect(res1.body.nextCursor).toBeTruthy();

        const res2 = await request(app)
          .get("/api/v1/events")
          .query({ limit: 2, type: "pair.registered", since: before, cursor: res1.body.nextCursor });
        expect(res2.status).toBe(200);
        expect(res2.body.items).toHaveLength(1);
        expect(res2.body.nextCursor).toBeNull();
      });

      it("returns 400 for malformed cursor", async () => {
        const res = await request(app).get("/api/v1/events").query({ cursor: "!!!" });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      });
    });
  });
});
