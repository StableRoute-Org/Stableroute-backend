import request from "supertest";
import app from "../index";
import { pairMeta, HEALTH_PROBE_KEY } from "../stores";

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
    const clock = res.body.checks.find(
      (c: { name: string }) => c.name === "clock",
    );
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

  it("probe cleans up: HEALTH_PROBE_KEY is not left in pairMeta after probe runs", async () => {
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);
    // The scratch key must be deleted after the storage round-trip.
    expect(pairMeta.has(HEALTH_PROBE_KEY)).toBe(false);
  });

  it("probe uses a reserved sentinel key that real pair keys can never produce", () => {
    // HEALTH_PROBE_KEY starts with a NUL control character, which is
    // outside the printable range of any valid asset code string.
    expect(HEALTH_PROBE_KEY.startsWith("\x00")).toBe(true);
  });

  it("probe does not clobber pre-existing operator pair metadata", async () => {
    // Register a pair and set custom metadata before triggering the probe.
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "PROBEA", destination: "PROBEB" });
    await request(app)
      .patch("/api/v1/pairs/PROBEA/PROBEB/fee_bps")
      .send({ feeBps: 42 });

    // Run the deep probe.
    const probeRes = await request(app).get("/api/v1/health/deep");
    expect(probeRes.status).toBe(200);
    expect(probeRes.body.status).toBe("ok");

    // Operator metadata must be intact.
    const info = await request(app).get("/api/v1/pairs/PROBEA/PROBEB/info");
    expect(info.status).toBe(200);
    expect(info.body.feeBps).toBe(42);

    // Cleanup
    await request(app).delete("/api/v1/pairs/PROBEA/PROBEB");
  });

  it("degraded path still returns 503 with all required fields", async () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(1000);

    const res = await request(app).get("/api/v1/health/deep");
    spy.mockRestore();

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body).toHaveProperty("uptimeSeconds");
    expect(res.body).toHaveProperty("memory");
    expect(res.body).toHaveProperty("pid");
    expect(res.body).toHaveProperty("checks");
  });
});
