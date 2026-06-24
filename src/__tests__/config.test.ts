import request from "supertest";
import app from "../index";

const ALLOWED = ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems"] as const;

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

  it("PATCH silently ignores a non-allowlisted key (eventLogCap)", async () => {
    const before = (await request(app).get("/api/v1/config")).body.config.eventLogCap;

    const res = await request(app)
      .patch("/api/v1/config")
      .send({ eventLogCap: before + 999 });
    expect(res.status).toBe(200);
    expect(res.body.config.eventLogCap).toBe(before);

    const after = (await request(app).get("/api/v1/config")).body.config.eventLogCap;
    expect(after).toBe(before);
  });
});
