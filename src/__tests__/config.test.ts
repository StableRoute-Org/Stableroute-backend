import request from "supertest";
import app from "../index";
import { eventLog, resetStores, EVENT_LOG_CAP_MAX, type EventType } from "../stores";

/** All keys the config PATCH handler accepts. Must stay in sync with the handler's allowed list. */
const ALLOWED = ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems", "eventLogCap", "quote_ttl_ms"] as const;

/** BULK_ABSOLUTE_MAX is a private constant in src/index.ts; mirror it here for validation tests. */
const BULK_ABSOLUTE_MAX = 10_000;

describe("config GET/PATCH", () => {
  let original: Record<string, number>;

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/config");
    original = res.body.config;
  });

  afterEach(async () => {
    // Restore the allowed config keys to their snapshotted values.
    const restore: Record<string, number> = {};
    for (const k of ALLOWED) {
      if (original[k] !== undefined) restore[k] = original[k];
    }
    await request(app).patch("/api/v1/config").send(restore);
    resetStores();
  });

  // ────────────────────────────────────────────────────────────────
  // GET /api/v1/config
  // ────────────────────────────────────────────────────────────────

  it("GET returns { config } with all expected keys", async () => {
    const res = await request(app).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(
      expect.objectContaining({
        rateLimitPerWindow: expect.any(Number),
        rateLimitWindowMs: expect.any(Number),
        bulkMaxItems: expect.any(Number),
        eventLogCap: expect.any(Number),
        quote_ttl_ms: expect.any(Number),
      })
    );
  });

  it("GET response is JSON and has no unexpected top-level keys", async () => {
    const res = await request(app).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["config"]);
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — allowed key update & persistence
  // ────────────────────────────────────────────────────────────────

  it("PATCH bulkMaxItems persists on the next GET", async () => {
    const next = original.bulkMaxItems + 7;
    const patch = await request(app).patch("/api/v1/config").send({ bulkMaxItems: next });
    expect(patch.status).toBe(200);
    expect(patch.body.config.bulkMaxItems).toBe(next);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.bulkMaxItems).toBe(next);
  });

  it("PATCH rateLimitPerWindow persists on the next GET", async () => {
    const next = original.rateLimitPerWindow + 13;
    const patch = await request(app).patch("/api/v1/config").send({ rateLimitPerWindow: next });
    expect(patch.status).toBe(200);
    expect(patch.body.config.rateLimitPerWindow).toBe(next);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.rateLimitPerWindow).toBe(next);
  });

  it("PATCH rateLimitWindowMs persists on the next GET", async () => {
    const next = original.rateLimitWindowMs + 5_000;
    const patch = await request(app).patch("/api/v1/config").send({ rateLimitWindowMs: next });
    expect(patch.status).toBe(200);
    expect(patch.body.config.rateLimitWindowMs).toBe(next);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.rateLimitWindowMs).toBe(next);
  });

  it("PATCH quote_ttl_ms persists on the next GET", async () => {
    const next = 60_000;
    const patch = await request(app).patch("/api/v1/config").send({ quote_ttl_ms: next });
    expect(patch.status).toBe(200);
    expect(patch.body.config.quote_ttl_ms).toBe(next);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.quote_ttl_ms).toBe(next);
  });

  it("PATCH eventLogCap persists and is reflected in the next GET", async () => {
    const newCap = 500;
    const patch = await request(app).patch("/api/v1/config").send({ eventLogCap: newCap });
    expect(patch.status).toBe(200);
    expect(patch.body.config.eventLogCap).toBe(newCap);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.eventLogCap).toBe(newCap);
  });

  it("PATCH multiple allowed keys at once persists all on next GET", async () => {
    const patch = await request(app).patch("/api/v1/config").send({
      bulkMaxItems: 77,
      rateLimitPerWindow: 88,
      rateLimitWindowMs: 99_000,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.config.bulkMaxItems).toBe(77);
    expect(patch.body.config.rateLimitPerWindow).toBe(88);
    expect(patch.body.config.rateLimitWindowMs).toBe(99_000);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.bulkMaxItems).toBe(77);
    expect(get.body.config.rateLimitPerWindow).toBe(88);
    expect(get.body.config.rateLimitWindowMs).toBe(99_000);
  });

  it("PATCH with empty body returns 200 with unchanged config", async () => {
    const patch = await request(app).patch("/api/v1/config").send({});
    expect(patch.status).toBe(200);
    expect(patch.body.config).toEqual(
      expect.objectContaining({
        rateLimitPerWindow: original.rateLimitPerWindow,
        rateLimitWindowMs: original.rateLimitWindowMs,
        bulkMaxItems: original.bulkMaxItems,
        eventLogCap: original.eventLogCap,
      })
    );
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — validation: rejects non-positive-integer values
  // ────────────────────────────────────────────────────────────────

  it.each([
    ["float", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["string", "100"],
  ])("PATCH bulkMaxItems rejects %s value with 400 invalid_request", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ bulkMaxItems: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it.each([
    ["float", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["string", "100"],
  ])("PATCH rateLimitPerWindow rejects %s value with 400 invalid_request", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitPerWindow: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it.each([
    ["float", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["string", "100"],
  ])("PATCH rateLimitWindowMs rejects %s value with 400 invalid_request", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitWindowMs: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it.each([
    ["float", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["string", "100"],
  ])("PATCH quote_ttl_ms rejects %s value with 400 invalid_request", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ quote_ttl_ms: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — type-confusion values (array, boolean, object, null)
  // ────────────────────────────────────────────────────────────────

  it.each([
    ["array", [1, 2, 3]],
    ["boolean", true],
    ["boolean false", false],
    ["object", { nested: 1 }],
    ["null", null],
  ])("PATCH bulkMaxItems rejects %s value with 400", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ bulkMaxItems: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH rateLimitPerWindow rejects array value with 400", async () => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitPerWindow: [10, 20] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH quote_ttl_ms rejects boolean value with 400", async () => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ quote_ttl_ms: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — ceiling enforcement
  // ────────────────────────────────────────────────────────────────

  it("PATCH bulkMaxItems rejects values above BULK_ABSOLUTE_MAX (10_000) with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({ bulkMaxItems: BULK_ABSOLUTE_MAX + 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("cannot exceed");
  });

  it("PATCH bulkMaxItems accepts BULK_ABSOLUTE_MAX (10_000) at the boundary", async () => {
    const res = await request(app).patch("/api/v1/config").send({ bulkMaxItems: BULK_ABSOLUTE_MAX });
    expect(res.status).toBe(200);
    expect(res.body.config.bulkMaxItems).toBe(BULK_ABSOLUTE_MAX);
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — non-allowlisted key enforcement
  // ────────────────────────────────────────────────────────────────

  it("PATCH rejects a completely unknown key with 400 invalid_request", async () => {
    const res = await request(app).patch("/api/v1/config").send({ unknownKey: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("unknown field");
    expect(res.body.unknownKeys).toEqual(["unknownKey"]);
    expect(res.body.requestId).toBeTruthy();
  });

  it("PATCH rejects a mix of known and unknown keys with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({
      bulkMaxItems: 200,
      extraField: "should be rejected",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.unknownKeys).toContain("extraField");
  });

  it("PATCH rejects multiple unknown keys listing all offending keys", async () => {
    const res = await request(app).patch("/api/v1/config").send({
      foo: 1,
      bar: 2,
      baz: 3,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.unknownKeys).toEqual(expect.arrayContaining(["foo", "bar", "baz"]));
  });

  it("PATCH does not mutate config when unknown keys are rejected", async () => {
    const getBefore = await request(app).get("/api/v1/config");
    await request(app).patch("/api/v1/config").send({ notAllowed: 999 }).expect(400);
    const getAfter = await request(app).get("/api/v1/config");
    // Config should be unchanged after a rejected request
    expect(getAfter.body.config).toEqual(getBefore.body.config);
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH — eventLogCap specific tests
  // ────────────────────────────────────────────────────────────────

  it("PATCH eventLogCap rejects zero with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH eventLogCap rejects negative values with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: -10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH eventLogCap rejects values above EVENT_LOG_CAP_MAX with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: EVENT_LOG_CAP_MAX + 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH eventLogCap rejects float value with 400", async () => {
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 500.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH eventLogCap trims existing eventLog immediately when lowered", async () => {
    // Seed more events than the new cap
    for (let i = 0; i < 20; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: { i } });
    }
    expect(eventLog.length).toBe(20);

    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 5 });
    expect(res.status).toBe(200);
    expect(eventLog.length).toBe(5);
    // oldest-first eviction: remaining entries are the 5 newest
    expect(eventLog[0].payload).toEqual({ i: 15 });
    expect(eventLog[4].payload).toEqual({ i: 19 });
  });

  it("GET /api/v1/events limit clamp respects configured eventLogCap", async () => {
    // Lower cap to 10 and verify limit is clamped to the new cap
    await request(app).patch("/api/v1/config").send({ eventLogCap: 10 });
    for (let i = 0; i < 10; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: {} });
    }
    // Requesting more than the cap should be clamped to the cap
    const res = await request(app).get("/api/v1/events?limit=9999");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(10);
  });

  it("PATCH eventLogCap to 1 (cap-of-1 edge case) trims buffer to 1", async () => {
    for (let i = 0; i < 5; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: { i } });
    }
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 1 });
    expect(res.status).toBe(200);
    expect(eventLog.length).toBe(1);
    // Only the newest entry survives
    expect(eventLog[0].payload).toEqual({ i: 4 });
  });

  it("PATCH eventLogCap does not trim when buffer is already within new cap", async () => {
    for (let i = 0; i < 3; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: { i } });
    }
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 100 });
    expect(res.status).toBe(200);
    expect(eventLog.length).toBe(3);
  });

  it("PATCH eventLogCap with a full buffer at cap does not lose entries unnecessarily", async () => {
    // Lower cap to 5 and fill exactly to the new cap
    await request(app).patch("/api/v1/config").send({ eventLogCap: 5 });
    for (let i = 0; i < 5; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: { i } });
    }
    expect(eventLog.length).toBe(5);
    // No trim needed; buffer is at cap
    expect(eventLog[0].payload).toEqual({ i: 0 });
  });

  it("PATCH eventLogCap accepts EVENT_LOG_CAP_MAX (boundary)", async () => {
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: EVENT_LOG_CAP_MAX });
    expect(res.status).toBe(200);
    expect(res.body.config.eventLogCap).toBe(EVENT_LOG_CAP_MAX);
  });
});
