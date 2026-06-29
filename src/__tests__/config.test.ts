import request from "supertest";
import app from "../index";
import { eventLog, resetStores, EVENT_LOG_CAP_MAX } from "../stores";

const ALLOWED = ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems", "eventLogCap"] as const;

describe("config GET/PATCH", () => {
  let original: Record<string, number>;

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/config");
    original = res.body.config;
  });

  afterEach(async () => {
    // Restore the allowed config keys to their snapshotted values.
    const restore: Record<string, number> = {};
    for (const k of ALLOWED) restore[k] = original[k];
    await request(app).patch("/api/v1/config").send(restore);
    resetStores();
  });

  it("GET returns { config } with all four keys", async () => {
    const res = await request(app).get("/api/v1/config");
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual(
      expect.objectContaining({
        rateLimitPerWindow: expect.any(Number),
        rateLimitWindowMs: expect.any(Number),
        bulkMaxItems: expect.any(Number),
        eventLogCap: expect.any(Number),
      })
    );
  });

  it("PATCH an allowed key persists on the next GET", async () => {
    const next = original.bulkMaxItems + 7;
    const patch = await request(app).patch("/api/v1/config").send({ bulkMaxItems: next });
    expect(patch.status).toBe(200);
    expect(patch.body.config.bulkMaxItems).toBe(next);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.bulkMaxItems).toBe(next);
  });

  it.each([
    ["non-integer", 1.5],
    ["zero", 0],
    ["negative", -1],
    ["string", "100"],
  ])("PATCH rejects %s value with 400 invalid_request", async (_label, value) => {
    const res = await request(app)
      .patch("/api/v1/config")
      .send({ bulkMaxItems: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it("PATCH eventLogCap persists and is reflected in the next GET", async () => {
    const newCap = 500;
    const patch = await request(app).patch("/api/v1/config").send({ eventLogCap: newCap });
    expect(patch.status).toBe(200);
    expect(patch.body.config.eventLogCap).toBe(newCap);

    const get = await request(app).get("/api/v1/config");
    expect(get.body.config.eventLogCap).toBe(newCap);
  });

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

  it("PATCH eventLogCap trims existing eventLog immediately when lowered", async () => {
    // Seed more events than the new cap
    for (let i = 0; i < 20; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "fill", payload: { i } });
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
      eventLog.push({ id: `e${i}`, ts: i, type: "fill", payload: {} });
    }
    // Requesting more than the cap should be clamped to the cap
    const res = await request(app).get("/api/v1/events?limit=9999");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(10);
  });

  it("PATCH eventLogCap to 1 (cap-of-1 edge case) trims buffer to 1", async () => {
    for (let i = 0; i < 5; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "fill", payload: { i } });
    }
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 1 });
    expect(res.status).toBe(200);
    expect(eventLog.length).toBe(1);
    // Only the newest entry survives
    expect(eventLog[0].payload).toEqual({ i: 4 });
  });

  it("PATCH eventLogCap does not trim when buffer is already within new cap", async () => {
    for (let i = 0; i < 3; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "fill", payload: { i } });
    }
    const res = await request(app).patch("/api/v1/config").send({ eventLogCap: 100 });
    expect(res.status).toBe(200);
    expect(eventLog.length).toBe(3);
  });

  it("PATCH eventLogCap with a full buffer at cap does not lose entries unnecessarily", async () => {
    // Lower cap to 5 and fill exactly to the new cap
    await request(app).patch("/api/v1/config").send({ eventLogCap: 5 });
    for (let i = 0; i < 5; i++) {
      eventLog.push({ id: `e${i}`, ts: i, type: "fill", payload: { i } });
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
