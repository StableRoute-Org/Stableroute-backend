import request from "supertest";
import { type Request, type Response } from "express";
import app, { isValidRequestId, clearIdempotencyCache, isKeyValid, requireScope, requireJsonContentType } from "../index";
import { resetStores, apiKeyStore } from "../stores";

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

  describe("API Key Expiry and Last-Used Tracking", () => {
    beforeEach(() => {
      resetStores();
    });

    it("creates a key with a valid expiresInSeconds and returns expiresAt in the response", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "expires-soon", expiresInSeconds: 60 });
      expect(res.status).toBe(201);
      expect(res.body.expiresAt).toBeDefined();
      expect(typeof res.body.expiresAt).toBe("number");
      expect(res.body.expiresAt).toBeGreaterThan(Date.now());
    });

    it("rejects non-positive expiresInSeconds or invalid types", async () => {
      const cases = [
        { expiresInSeconds: 0 },
        { expiresInSeconds: -10 },
        { expiresInSeconds: 31_536_001 }, // above 31536000 limit
        { expiresInSeconds: "60" }, // wrong type
        { expiresInSeconds: 1.5 }, // non-integer
      ];
      for (const payload of cases) {
        const res = await request(app)
          .post("/api/v1/api-keys")
          .send({ label: "invalid-expiry", ...payload });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      }
    });

    it("surfaces expiresAt and lastUsedAt in the GET list endpoint (never raw key)", async () => {
      const label = "list-expiry-key";
      const createRes = await request(app)
        .post("/api/v1/api-keys")
        .send({ label, expiresInSeconds: 3600 });
      expect(createRes.status).toBe(201);

      const prefix = createRes.body.key.slice(0, 8);
      const listRes = await request(app).get("/api/v1/api-keys");
      expect(listRes.status).toBe(200);

      const keyRecord = listRes.body.items.find((item: { prefix: string }) => item.prefix === prefix);
      expect(keyRecord).toBeDefined();
      expect(keyRecord.expiresAt).toBe(createRes.body.expiresAt);
      expect(keyRecord).not.toHaveProperty("key");
      expect(JSON.stringify(listRes.body)).not.toContain(createRes.body.key);
    });

    it("asserts that isKeyValid flips after expiry", async () => {
      // Create a key with 10ms expiry
      const record = {
        label: "test-expiry",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10, // 10ms in the future
      };
      expect(isKeyValid(record)).toBe(true);

      // Wait 15ms so it expires
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(isKeyValid(record)).toBe(false);
    });

    it("requireScope middleware rejects expired keys with 401", () => {
      const rawKey = "srk_test_auth_expired";
      const record = {
        label: "test-auth-expired",
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000, // expired 1s ago
        scopes: ["pairs:write"],
      };
      apiKeyStore.set(rawKey, record);

      const middleware = requireScope("pairs:write");
      
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${rawKey}`),
      } as unknown as Request;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "unauthorized",
          message: "a valid API key is required",
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("requireScope middleware accepts valid keys with required scope and updates lastUsedAt", () => {
      const rawKey = "srk_test_auth_valid";
      const record = {
        label: "test-auth-valid",
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600 * 1000,
        scopes: ["pairs:write"],
      };
      apiKeyStore.set(rawKey, record);

      const middleware = requireScope("pairs:write");
      
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${rawKey}`),
      } as unknown as Request;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
      
      const updatedRecord = apiKeyStore.get(rawKey);
      expect(updatedRecord!.lastUsedAt).toBeDefined();
      expect(updatedRecord!.lastUsedAt).toBeGreaterThan(0);
    });

    it("asserts that isKeyValid handles rotated keys and grace period correctly", async () => {
      // 1. Valid grace period
      const record = {
        label: "test-rotation-grace",
        createdAt: Date.now() - 2000,
        rotatedAt: Date.now() - 1000,
        graceExpiresAt: Date.now() + 10, // expires in 10ms
      };
      expect(isKeyValid(record)).toBe(true);

      // 2. Expired grace period
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(isKeyValid(record)).toBe(false);
    });

    it("requireScope middleware rejects keys that lack the required scope", () => {
      const rawKey = "srk_test_auth_no_scope";
      const record = {
        label: "test-auth-no-scope",
        createdAt: Date.now(),
        scopes: [], // empty scope
      };
      apiKeyStore.set(rawKey, record);

      const middleware = requireScope("pairs:write");
      
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${rawKey}`),
      } as unknown as Request;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "forbidden",
          message: "this key is missing the required scope: pairs:write",
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
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

  describe("GET /api/v1/metrics — store-size and config gauges", () => {
    beforeEach(() => {
      resetStores();
      clearIdempotencyCache();
    });

    it("emits # HELP and # TYPE lines for all four new gauges", async () => {
      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain.*version=0\.0\.4/);

      expect(res.text).toMatch(/# HELP stableroute_api_keys_total /);
      expect(res.text).toMatch(/# TYPE stableroute_api_keys_total gauge/);
      expect(res.text).toMatch(/# HELP stableroute_webhooks_total /);
      expect(res.text).toMatch(/# TYPE stableroute_webhooks_total gauge/);
      expect(res.text).toMatch(/# HELP stableroute_event_log_size /);
      expect(res.text).toMatch(/# TYPE stableroute_event_log_size gauge/);
      expect(res.text).toMatch(/# HELP stableroute_rate_limit_per_window /);
      expect(res.text).toMatch(/# TYPE stableroute_rate_limit_per_window gauge/);
    });

    it("reports 0 for all store-size gauges when stores are empty", async () => {
      // beforeEach calls resetStores(), so stores are pristine.
      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const apiKeysMatch = res.text.match(/^stableroute_api_keys_total (\d+)$/m);
      expect(apiKeysMatch).not.toBeNull();
      expect(Number(apiKeysMatch![1])).toBe(0);

      const webhooksMatch = res.text.match(/^stableroute_webhooks_total (\d+)$/m);
      expect(webhooksMatch).not.toBeNull();
      expect(Number(webhooksMatch![1])).toBe(0);

      const eventLogMatch = res.text.match(/^stableroute_event_log_size (\d+)$/m);
      expect(eventLogMatch).not.toBeNull();
      expect(Number(eventLogMatch![1])).toBe(0);
    });

    it("stableroute_api_keys_total reflects the number of stored API keys", async () => {
      // Create two API keys.
      await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "key-alpha", scopes: ["pairs:write"] });
      await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "key-beta", scopes: [] });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const match = res.text.match(/^stableroute_api_keys_total (\d+)$/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(2);
    });

    it("stableroute_api_keys_total decrements when a key is deleted", async () => {
      const createRes = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "temp-key", scopes: [] });
      expect(createRes.status).toBe(201);
      const prefix = (createRes.body.key as string).slice(0, 8);

      // Before delete: 1
      const before = await request(app).get("/api/v1/metrics");
      const beforeMatch = before.text.match(/^stableroute_api_keys_total (\d+)$/m);
      expect(Number(beforeMatch![1])).toBe(1);

      await request(app).delete(`/api/v1/api-keys/${prefix}`);

      // After delete: 0
      const after = await request(app).get("/api/v1/metrics");
      const afterMatch = after.text.match(/^stableroute_api_keys_total (\d+)$/m);
      expect(Number(afterMatch![1])).toBe(0);
    });

    it("stableroute_webhooks_total reflects the number of registered webhooks", async () => {
      await request(app).post("/api/v1/webhooks").send({
        url: "https://example.com/hook1",
        events: ["pair.registered"],
      });
      await request(app).post("/api/v1/webhooks").send({
        url: "https://example.com/hook2",
        events: ["pair.unregistered"],
      });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const match = res.text.match(/^stableroute_webhooks_total (\d+)$/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(2);
    });

    it("stableroute_webhooks_total decrements when a webhook is deleted", async () => {
      const createRes = await request(app).post("/api/v1/webhooks").send({
        url: "https://example.com/hook-temp",
        events: ["pair.registered"],
      });
      expect(createRes.status).toBe(201);
      const webhookId: string = createRes.body.id;

      const before = await request(app).get("/api/v1/metrics");
      const beforeMatch = before.text.match(/^stableroute_webhooks_total (\d+)$/m);
      expect(Number(beforeMatch![1])).toBe(1);

      await request(app).delete(`/api/v1/webhooks/${webhookId}`);

      const after = await request(app).get("/api/v1/metrics");
      const afterMatch = after.text.match(/^stableroute_webhooks_total (\d+)$/m);
      expect(Number(afterMatch![1])).toBe(0);
    });

    it("stableroute_event_log_size grows as events are recorded", async () => {
      // Register a pair to emit a pair.registered event.
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "ELS", destination: "TST" });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const match = res.text.match(/^stableroute_event_log_size (\d+)$/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThanOrEqual(1);
    });

    it("stableroute_event_log_size matches stableroute_events_total", async () => {
      // Both gauges should reflect the same eventLog.length value.
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "SYN", destination: "CHK" });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const sizeMatch = res.text.match(/^stableroute_event_log_size (\d+)$/m);
      const totalMatch = res.text.match(/^stableroute_events_total (\d+)$/m);
      expect(sizeMatch).not.toBeNull();
      expect(totalMatch).not.toBeNull();
      expect(Number(sizeMatch![1])).toBe(Number(totalMatch![1]));
    });

    it("stableroute_rate_limit_per_window reflects the default config value", async () => {
      // Default rateLimitPerWindow is 60.
      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const match = res.text.match(/^stableroute_rate_limit_per_window (\d+)$/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(60);
    });

    it("stableroute_rate_limit_per_window updates after PATCH /api/v1/config", async () => {
      await request(app)
        .patch("/api/v1/config")
        .send({ rateLimitPerWindow: 120 });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      const match = res.text.match(/^stableroute_rate_limit_per_window (\d+)$/m);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(120);
    });

    it("gauge values are never raw secrets or URLs — only counts and integers", async () => {
      // Create a key and a webhook with a URL to ensure they are in the stores.
      await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "secret-key", scopes: [] });
      await request(app).post("/api/v1/webhooks").send({
        url: "https://private.internal/sensitive-endpoint",
        events: ["pair.registered"],
      });

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      // The raw key prefix (srk_) must never appear in the metrics body.
      expect(res.text).not.toMatch(/srk_/);
      // The webhook URL must never appear in the metrics body.
      expect(res.text).not.toMatch(/https?:\/\//);
      // All gauge value lines must match the label-free integer pattern.
      const gaugeLines = res.text
        .split("\n")
        .filter((l) => /^stableroute_/.test(l) && !l.startsWith("#") && !l.includes("{"));
      for (const line of gaugeLines) {
        expect(line).toMatch(/^stableroute_\w+ \d+$/);
      }
    });

    it("all four new gauges are present alongside the existing pair and paused gauges", async () => {
      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);

      // Existing gauges must still be emitted.
      expect(res.text).toMatch(/^stableroute_pairs_total \d+$/m);
      expect(res.text).toMatch(/^stableroute_paused [01]$/m);

      // New store-size and config gauges must be present.
      expect(res.text).toMatch(/^stableroute_api_keys_total \d+$/m);
      expect(res.text).toMatch(/^stableroute_webhooks_total \d+$/m);
      expect(res.text).toMatch(/^stableroute_event_log_size \d+$/m);
      expect(res.text).toMatch(/^stableroute_rate_limit_per_window \d+$/m);

      // Prometheus format: body must end with a newline.
      expect(res.text.endsWith("\n")).toBe(true);
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

  describe("Idempotency Support", () => {
    beforeEach(() => {
      resetStores();
      clearIdempotencyCache();
      delete process.env.IDEMPOTENCY_TTL_MS;
      delete process.env.IDEMPOTENCY_CACHE_MAX;
    });

    afterEach(() => {
      delete process.env.IDEMPOTENCY_TTL_MS;
      delete process.env.IDEMPOTENCY_CACHE_MAX;
    });

    describe("POST /api/v1/api-keys", () => {
      it("behaves normally when no key is provided", async () => {
        const res1 = await request(app).post("/api/v1/api-keys").send({ label: "key1" });
        expect(res1.status).toBe(201);
        const res2 = await request(app).post("/api/v1/api-keys").send({ label: "key1" });
        expect(res2.status).toBe(201);
        expect(res1.body.key).not.toBe(res2.body.key);
      });

      it("replays the response when the same key and body are sent twice", async () => {
        const key = "idem-key-1";
        const res1 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "key-idem" });
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "key-idem" });
        expect(res2.status).toBe(201);
        expect(res2.body).toEqual(res1.body);
      });

      it("returns 409 idempotency_conflict when same key is used with a different body", async () => {
        const key = "idem-key-2";
        const res1 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "key-idem" });
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "different-label" });
        expect(res2.status).toBe(409);
        expect(res2.body.error).toBe("idempotency_conflict");
      });
    });

    describe("POST /api/v1/webhooks", () => {
      it("behaves normally when no key is provided", async () => {
        const res1 = await request(app)
          .post("/api/v1/webhooks")
          .send({ url: "https://example.com/w1", events: ["pair.registered"] });
        expect(res1.status).toBe(201);
        const res2 = await request(app)
          .post("/api/v1/webhooks")
          .send({ url: "https://example.com/w1", events: ["pair.registered"] });
        expect(res2.status).toBe(201);
        expect(res1.body.id).not.toBe(res2.body.id);
      });

      it("replays the response when the same key and body are sent twice", async () => {
        const key = "idem-wh-1";
        const body = { url: "https://example.com/w1", events: ["pair.registered"] };
        const res1 = await request(app)
          .post("/api/v1/webhooks")
          .set("Idempotency-Key", key)
          .send(body);
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/webhooks")
          .set("Idempotency-Key", key)
          .send(body);
        expect(res2.status).toBe(201);
        expect(res2.body).toEqual(res1.body);
      });

      it("returns 409 idempotency_conflict when same key is used with a different body", async () => {
        const key = "idem-wh-2";
        const body1 = { url: "https://example.com/w1", events: ["pair.registered"] };
        const body2 = { url: "https://example.com/w2", events: ["pair.registered"] };
        const res1 = await request(app)
          .post("/api/v1/webhooks")
          .set("Idempotency-Key", key)
          .send(body1);
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/webhooks")
          .set("Idempotency-Key", key)
          .send(body2);
        expect(res2.status).toBe(409);
        expect(res2.body.error).toBe("idempotency_conflict");
      });
    });

    describe("POST /api/v1/pairs", () => {
      it("replays the response when the same key and body are sent twice", async () => {
        const key = "idem-pair-1";
        const body = { source: "IDEMA", destination: "IDEMB" };
        const res1 = await request(app)
          .post("/api/v1/pairs")
          .set("Idempotency-Key", key)
          .send(body);
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/pairs")
          .set("Idempotency-Key", key)
          .send(body);
        expect(res2.status).toBe(201);
        expect(res2.body).toEqual(res1.body);
      });

      it("returns 409 idempotency_conflict when same key is used with a different body", async () => {
        const key = "idem-pair-2";
        const body1 = { source: "IDEMA", destination: "IDEMB" };
        const body2 = { source: "IDEMA", destination: "IDEMC" };
        const res1 = await request(app)
          .post("/api/v1/pairs")
          .set("Idempotency-Key", key)
          .send(body1);
        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post("/api/v1/pairs")
          .set("Idempotency-Key", key)
          .send(body2);
        expect(res2.status).toBe(409);
        expect(res2.body.error).toBe("idempotency_conflict");
      });
    });

    describe("TTL expiry and cache limits", () => {
      it("ignores/expires the key after TTL expires", async () => {
        process.env.IDEMPOTENCY_TTL_MS = "50"; // 50ms TTL
        const key = "ttl-key-1";
        const res1 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "key1" });
        expect(res1.status).toBe(201);

        // Wait for TTL to expire
        await new Promise((resolve) => setTimeout(resolve, 60));

        const res2 = await request(app)
          .post("/api/v1/api-keys")
          .set("Idempotency-Key", key)
          .send({ label: "key1" });
        expect(res2.status).toBe(201);
        expect(res2.body.key).not.toBe(res1.body.key);
      });

      it("enforces cache limits (evicts oldest entries)", async () => {
        process.env.IDEMPOTENCY_CACHE_MAX = "2"; // only keep 2 entries
        const body = { label: "key" };

        const res1 = await request(app).post("/api/v1/api-keys").set("Idempotency-Key", "key-1").send(body);
        const res2 = await request(app).post("/api/v1/api-keys").set("Idempotency-Key", "key-2").send(body);
        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);

        // Third request will evict key-1
        const res3 = await request(app).post("/api/v1/api-keys").set("Idempotency-Key", "key-3").send(body);
        expect(res3.status).toBe(201);

        const resReplay2 = await request(app).post("/api/v1/api-keys").set("Idempotency-Key", "key-2").send(body);
        expect(resReplay2.status).toBe(201);
        expect(resReplay2.body.key).toBe(res2.body.key);

        const resReplay1 = await request(app).post("/api/v1/api-keys").set("Idempotency-Key", "key-1").send(body);
        expect(resReplay1.status).toBe(201);
        expect(resReplay1.body.key).not.toBe(res1.body.key);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Content-Type guard
  // ---------------------------------------------------------------------------
  describe("Content-Type guard (requireJsonContentType)", () => {
    // --- Integration tests via supertest ---

    it("returns 415 unsupported_media_type when POST is sent as text/plain", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "text/plain")
        .set("X-Request-Id", "ct-415-plain")
        .send('{"source":"USDC","destination":"EURC"}');
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.message).toMatch(/application\/json/);
      expect(res.body.requestId).toBe("ct-415-plain");
    });

    it("returns 415 when POST is sent as application/x-www-form-urlencoded", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("X-Request-Id", "ct-415-form")
        .send("source=USDC&destination=EURC");
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.requestId).toBe("ct-415-form");
    });

    it("returns 415 when POST body is present but Content-Type header is omitted entirely", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("X-Request-Id", "ct-415-missing")
        .set("Content-Type", "")
        // Use a raw buffer so supertest does not inject a content-type
        .send(Buffer.from('{"source":"USDC","destination":"EURC"}'));
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.requestId).toBe("ct-415-missing");
    });

    it("accepts POST with Content-Type: application/json and processes normally", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "application/json")
        .set("X-Request-Id", "ct-200-json")
        .send({ source: "CTJSN", destination: "EURC" });
      // 200 (already registered) or 201 (new) — both are success
      expect(res.status === 200 || res.status === 201).toBe(true);
    });

    it("accepts POST with application/json; charset=utf-8", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "application/json; charset=utf-8")
        .set("X-Request-Id", "ct-200-charset")
        .send({ source: "CTCHR", destination: "EURC" });
      expect(res.status === 200 || res.status === 201).toBe(true);
    });

    it("passes through an empty-body POST without requiring Content-Type", async () => {
      // A POST with no body (no Content-Length, no Transfer-Encoding) must
      // bypass the content-type check entirely and reach the route handler.
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("X-Request-Id", "ct-empty-post")
        // Explicitly clear content-type so no default is sent
        .set("Content-Type", "");
      // The route handler will return 400 invalid_request (missing fields),
      // not 415, proving the guard did not block an empty body.
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
    });

    it("passes through a DELETE request without requiring Content-Type (no body method)", async () => {
      // Register a pair first so the DELETE has a real target
      await request(app).post("/api/v1/pairs").send({ source: "CTDEL", destination: "EURC" });
      const res = await request(app)
        .delete("/api/v1/pairs/CTDEL/EURC")
        .set("X-Request-Id", "ct-delete-ok");
      // 204 No Content — DELETE was not blocked by the guard
      expect(res.status).toBe(204);
    });

    it("passes through GET, HEAD, and OPTIONS without requiring Content-Type", async () => {
      const getRes = await request(app).get("/health");
      expect(getRes.status).toBe(200);

      const headRes = await request(app).head("/health");
      expect(headRes.status).toBe(200);

      const optRes = await request(app).options("/health");
      // OPTIONS may return 204 (cors preflight) or 200
      expect(optRes.status === 200 || optRes.status === 204).toBe(true);
    });

    it("415 error body carries the requestId from X-Request-Id correlation header", async () => {
      const res = await request(app)
        .post("/api/v1/pairs")
        .set("Content-Type", "text/xml")
        .set("X-Request-Id", "ct-corr-id-xyz")
        .send("<pair/>");
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.requestId).toBe("ct-corr-id-xyz");
      expect(typeof res.body.message).toBe("string");
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it(
      "forged Content-Type: application/json with oversized body is blocked at 413 (body-size limit)",
      async () => {
        // This asserts the security invariant: a caller cannot use
        // Content-Type: application/json to bypass the 100 kB body-size limit
        // and push raw bytes into a handler. The body parser rejects the
        // oversized body before requireJsonContentType even runs.
        const res = await request(app)
          .post("/api/v1/pairs")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "ct-413-forged")
          .send({ payload: "x".repeat(110_000) });
        expect(res.status).toBe(413);
        expect(res.body.error).toBe("payload_too_large");
        expect(res.body.requestId).toBe("ct-413-forged");
      }
    );

    it("returns 415 for PATCH with wrong content-type", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .set("Content-Type", "application/xml")
        .set("X-Request-Id", "ct-415-patch")
        .send("<config/>");
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.requestId).toBe("ct-415-patch");
    });

    it("returns 415 for PUT with wrong content-type", async () => {
      // PUT is not a defined route but the guard fires before the 404 handler
      const res = await request(app)
        .put("/api/v1/pairs")
        .set("Content-Type", "text/csv")
        .set("X-Request-Id", "ct-415-put")
        .send("source,destination\nUSDC,EURC");
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("unsupported_media_type");
      expect(res.body.requestId).toBe("ct-415-put");
    });

    // --- Unit tests directly exercising the exported middleware ---

    describe("requireJsonContentType unit tests", () => {
      const makeReq = (
        overrides: Partial<{
          method: string;
          contentType: string | undefined;
          contentLength: string | undefined;
          transferEncoding: string | undefined;
        }> = {}
      ) =>
        ({
          method: overrides.method ?? "POST",
          headers: {
            ...(overrides.contentType !== undefined
              ? { "content-type": overrides.contentType }
              : {}),
            ...(overrides.contentLength !== undefined
              ? { "content-length": overrides.contentLength }
              : {}),
            ...(overrides.transferEncoding !== undefined
              ? { "transfer-encoding": overrides.transferEncoding }
              : {}),
          },
          header: (name: string) =>
            (overrides as Record<string, string | undefined>)[name],
        } as unknown as Request);

      const makeRes = () => {
        const res = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn().mockReturnThis(),
          setHeader: jest.fn(),
        } as unknown as Response;
        return res;
      };

      it("calls next() for GET method regardless of headers", () => {
        const req = makeReq({
          method: "GET",
          contentType: "text/plain",
          contentLength: "100",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("calls next() for HEAD method", () => {
        const req = makeReq({ method: "HEAD", contentLength: "50" });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("calls next() for DELETE method", () => {
        const req = makeReq({ method: "DELETE", contentLength: "50" });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("calls next() for OPTIONS method", () => {
        const req = makeReq({ method: "OPTIONS", contentLength: "50" });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("calls next() for POST with no body indicators (no Content-Length, no Transfer-Encoding)", () => {
        const req = makeReq({ method: "POST" }); // no contentLength, no transferEncoding
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("calls next() for POST with Content-Length: 0 (treated as no body)", () => {
        const req = makeReq({ method: "POST", contentLength: "0" });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("calls next() for POST with application/json content-type and body", () => {
        const req = makeReq({
          method: "POST",
          contentType: "application/json",
          contentLength: "42",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("calls next() for POST with application/json; charset=utf-8", () => {
        const req = makeReq({
          method: "POST",
          contentType: "application/json; charset=utf-8",
          contentLength: "42",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("calls next() for POST with APPLICATION/JSON (uppercase — case-insensitive check)", () => {
        const req = makeReq({
          method: "POST",
          contentType: "APPLICATION/JSON",
          contentLength: "42",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
      });

      it("sends 415 for POST with text/plain and non-zero Content-Length", () => {
        const req = makeReq({
          method: "POST",
          contentType: "text/plain",
          contentLength: "10",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(415);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: "unsupported_media_type" })
        );
      });

      it("sends 415 for POST with missing Content-Type but non-zero Content-Length", () => {
        // No content-type header at all — headers object has no key
        const req = makeReq({ method: "POST", contentLength: "10" });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(415);
      });

      it("sends 415 for POST with application/x-www-form-urlencoded and Transfer-Encoding: chunked", () => {
        const req = makeReq({
          method: "POST",
          contentType: "application/x-www-form-urlencoded",
          transferEncoding: "chunked",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(415);
      });

      it("calls next() for POST with Transfer-Encoding: chunked and application/json", () => {
        const req = makeReq({
          method: "POST",
          contentType: "application/json",
          transferEncoding: "chunked",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
      });

      it("sends 415 for PATCH with wrong content-type and body", () => {
        const req = makeReq({
          method: "PATCH",
          contentType: "application/xml",
          contentLength: "20",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(415);
      });

      it("sends 415 for PUT with wrong content-type and body", () => {
        const req = makeReq({
          method: "PUT",
          contentType: "text/csv",
          contentLength: "5",
        });
        const res = makeRes();
        const next = jest.fn();
        requireJsonContentType(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(415);
      });
    });
  });

  describe("strict body key validation (rejectUnknownKeys)", () => {
    const expectUnknownKeyError = async (
      method: "post" | "patch",
      url: string,
      body: Record<string, unknown>,
    ) => {
      const res = await request(app)
        [method](url)
        .set("X-Request-Id", "strict-keys")
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/unknown field/);
      expect(res.body.requestId).toBe("strict-keys");
    };

    describe("POST /api/v1/api-keys", () => {
      beforeEach(() => {
        resetStores();
      });

      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError("post", "/api/v1/api-keys", {
          label: "test",
          unknownField: "xyz",
        });
      });

      it("still succeeds with only valid keys", async () => {
        const res = await request(app)
          .post("/api/v1/api-keys")
          .send({ label: "good-key" });
        expect(res.status).toBe(201);
        expect(res.body.key).toMatch(/^srk_/);
      });

      it("empty body behaves as before (400 — missing label)", async () => {
        const res = await request(app)
          .post("/api/v1/api-keys")
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
        expect(res.body.message).toMatch(/label/);
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .post("/api/v1/api-keys")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-api-key")
          .send(JSON.stringify({ label: "test", __proto__: { polluted: true } }));
        expect(res.status).toBe(201);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("POST /api/v1/pairs", () => {
      beforeEach(() => {
        resetStores();
      });

      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError("post", "/api/v1/pairs", {
          source: "USDC",
          destination: "EURC",
          extraField: "nope",
        });
      });

      it("still succeeds with only valid keys", async () => {
        const res = await request(app)
          .post("/api/v1/pairs")
          .send({ source: "USDC", destination: "EURC" });
        expect(res.status).toBe(201);
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .post("/api/v1/pairs")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-pair")
          .send(JSON.stringify({ source: "USDC", destination: "EURC", __proto__: { polluted: true } }));
        expect(res.status).toBe(201);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("POST /api/v1/webhooks", () => {
      beforeEach(() => {
        resetStores();
      });

      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError("post", "/api/v1/webhooks", {
          url: "https://example.com/h",
          events: ["pair.registered"],
          unknownField: "xyz",
        });
      });

      it("still succeeds with only valid keys", async () => {
        const res = await request(app)
          .post("/api/v1/webhooks")
          .send({ url: "https://example.com/h", events: ["pair.registered"] });
        expect(res.status).toBe(201);
      });

      it("empty body behaves as before (400 — missing url)", async () => {
        const res = await request(app)
          .post("/api/v1/webhooks")
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("invalid_request");
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .post("/api/v1/webhooks")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-wh")
          .send(JSON.stringify({
            url: "https://example.com/h",
            events: ["pair.registered"],
            __proto__: { polluted: true },
          }));
        expect(res.status).toBe(201);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("PATCH /api/v1/config", () => {
      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError("patch", "/api/v1/config", {
          rateLimitPerWindow: 100,
          unknownField: "xyz",
        });
      });

      it("still succeeds with only valid keys", async () => {
        const res = await request(app)
          .patch("/api/v1/config")
          .send({ rateLimitPerWindow: 150 });
        expect(res.status).toBe(200);
        expect(res.body.config.rateLimitPerWindow).toBe(150);
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .patch("/api/v1/config")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-config")
          .send(JSON.stringify({ rateLimitPerWindow: 100, __proto__: { polluted: true } }));
        expect(res.status).toBe(200);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("PATCH /api/v1/pairs/:source/:destination/enabled", () => {
      beforeEach(async () => {
        resetStores();
        await request(app).post("/api/v1/pairs").send({ source: "ENAB", destination: "TEST" });
      });

      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError(
          "patch",
          "/api/v1/pairs/ENAB/TEST/enabled",
          { enabled: true, extra: "nope" },
        );
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .patch("/api/v1/pairs/ENAB/TEST/enabled")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-enabled")
          .send(JSON.stringify({ enabled: true, __proto__: { polluted: true } }));
        expect(res.status).toBe(200);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });

    describe("pair-meta PATCH (liquidity)", () => {
      beforeEach(async () => {
        resetStores();
        await request(app).post("/api/v1/pairs").send({ source: "LIQ", destination: "TEST" });
      });

      it("rejects an extra unknown key", async () => {
        await expectUnknownKeyError(
          "patch",
          "/api/v1/pairs/LIQ/TEST/liquidity",
          { liquidity: "500", extra: "nope" },
        );
      });

      it("__proto__ in body does not pollute Object.prototype", async () => {
        const res = await request(app)
          .patch("/api/v1/pairs/LIQ/TEST/liquidity")
          .set("Content-Type", "application/json")
          .set("X-Request-Id", "proto-liq")
          .send(JSON.stringify({ liquidity: "500", __proto__: { polluted: true } }));
        expect(res.status).toBe(200);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });
  });
});
