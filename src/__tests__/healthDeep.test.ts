import request from "supertest";
import app from "../index";

describe("GET /api/v1/health/deep", () => {
  afterEach(async () => {
    // Restore any clock stub and ensure the service is never left paused.
    jest.restoreAllMocks();
    await request(app).post("/api/v1/admin/unpause");
  });

  it("ok path: 200 with status ok, both checks, and runtime fields", async () => {
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");

    const names = res.body.checks.map((c: { name: string }) => c.name);
    expect(names).toContain("storage");
    expect(names).toContain("clock");

    expect(res.body).toHaveProperty("uptimeSeconds");
    expect(res.body.memory).toHaveProperty("rssMb");
    expect(res.body.memory).toHaveProperty("heapUsedMb");
    expect(res.body).toHaveProperty("pid");
    expect(res.body).toHaveProperty("node");
  });

  it("degraded path: failing clock check yields 503 and status degraded", async () => {
    // Clock check passes only when Date.now() > 1577836800000 (2020-01-01).
    // Pinning it to 1000 forces that check to fail.
    const spy = jest.spyOn(Date, "now").mockReturnValue(1000);

    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    const clock = res.body.checks.find((c: { name: string }) => c.name === "clock");
    expect(clock.status).toBe("fail");

    spy.mockRestore();
  });

  it("paused path: 200 with status paused", async () => {
    await request(app).post("/api/v1/admin/pause");

    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paused");

    await request(app).post("/api/v1/admin/unpause");
  });
});
