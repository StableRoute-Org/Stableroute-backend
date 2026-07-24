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

  it("degraded path: failing storage check yields 503 and status degraded", async () => {
    // Force the storage check to fail by stubbing pairMeta.get to return undefined
    const originalGet = pairMeta.get.bind(pairMeta);
    const spy = jest
      .spyOn(pairMeta, "get")
      .mockImplementation((key: string) => {
        if (key === HEALTH_PROBE_KEY) {
          return undefined; // Force readback failure
        }
        return originalGet(key);
      });

    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");

    const storage = res.body.checks.find(
      (c: { name: string }) => c.name === "storage",
    );
    expect(storage).toBeDefined();
    expect(storage.status).toBe("fail");

    spy.mockRestore();
  });

  it("degraded path: storage exception yields 503 with fail status", async () => {
    // Force the storage check to throw an exception
    const originalSet = pairMeta.set.bind(pairMeta);
    const spy = jest.spyOn(pairMeta, "set").mockImplementation((key, value) => {
      if (key === HEALTH_PROBE_KEY) {
        throw new Error("Simulated storage error");
      }
      return originalSet(key, value);
    });

    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");

    const storage = res.body.checks.find(
      (c: { name: string }) => c.name === "storage",
    );
    expect(storage).toBeDefined();
    expect(storage.status).toBe("fail");

    spy.mockRestore();
  });

  it("all checks have correct shape: name, status, durationMs", async () => {
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);

    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.length).toBeGreaterThanOrEqual(2);

    for (const check of res.body.checks) {
      expect(check).toHaveProperty("name");
      expect(typeof check.name).toBe("string");
      expect(check.name.length).toBeGreaterThan(0);

      expect(check).toHaveProperty("status");
      expect(["ok", "fail"]).toContain(check.status);

      expect(check).toHaveProperty("durationMs");
      expect(typeof check.durationMs).toBe("number");
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
    }

    // Verify specific checks are present
    const storage = res.body.checks.find(
      (c: { name: string }) => c.name === "storage",
    );
    expect(storage).toBeDefined();
    expect(storage.status).toBe("ok");

    const clock = res.body.checks.find(
      (c: { name: string }) => c.name === "clock",
    );
    expect(clock).toBeDefined();
    expect(clock.status).toBe("ok");
  });

  it("paused state shows in status field but degraded checks still return 503", async () => {
    // Pause the service
    await request(app).post("/api/v1/admin/pause");

    // Mock a failing clock check
    const spy = jest.spyOn(Date, "now").mockReturnValue(1000);

    const res = await request(app).get("/api/v1/health/deep");

    // When both paused and degraded: HTTP status is 503, but status field is "paused"
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("paused");

    const clock = res.body.checks.find(
      (c: { name: string }) => c.name === "clock",
    );
    expect(clock.status).toBe("fail");

    spy.mockRestore();
    await request(app).post("/api/v1/admin/unpause");
  });

  it("response contains no secrets or sensitive data", async () => {
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);

    const bodyStr = JSON.stringify(res.body);

    // Verify no environment variables are leaked
    expect(bodyStr).not.toContain("API_KEY");
    expect(bodyStr).not.toContain("SECRET");
    expect(bodyStr).not.toContain("PASSWORD");
    expect(bodyStr).not.toContain("TOKEN");

    // Verify only expected fields are present
    const allowedKeys = [
      "status",
      "uptimeSeconds",
      "memory",
      "pid",
      "node",
      "checks",
    ];
    const actualKeys = Object.keys(res.body);
    expect(actualKeys.sort()).toEqual(allowedKeys.sort());

    // Verify memory object only has expected fields
    const allowedMemoryKeys = ["rssMb", "heapUsedMb"];
    const actualMemoryKeys = Object.keys(res.body.memory);
    expect(actualMemoryKeys.sort()).toEqual(allowedMemoryKeys.sort());
  });

  it("unpause after pause restores ok status", async () => {
    // Initial state should be ok
    const before = await request(app).get("/api/v1/health/deep");
    expect(before.status).toBe(200);
    expect(before.body.status).toBe("ok");

    // Pause the service
    await request(app).post("/api/v1/admin/pause");
    const paused = await request(app).get("/api/v1/health/deep");
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe("paused");

    // Unpause the service
    await request(app).post("/api/v1/admin/unpause");
    const after = await request(app).get("/api/v1/health/deep");
    expect(after.status).toBe(200);
    expect(after.body.status).toBe("ok");
  });

  it("multiple consecutive probes do not interfere with each other", async () => {
    // Run multiple probes in quick succession
    const results = await Promise.all([
      request(app).get("/api/v1/health/deep"),
      request(app).get("/api/v1/health/deep"),
      request(app).get("/api/v1/health/deep"),
    ]);

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.checks).toHaveLength(2);
    }

    // Verify cleanup happened correctly
    expect(pairMeta.has(HEALTH_PROBE_KEY)).toBe(false);
  });

  it("runtime fields have expected types and values", async () => {
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);

    // uptimeSeconds should be a positive integer
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(res.body.uptimeSeconds).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.uptimeSeconds)).toBe(true);

    // memory fields should be positive integers
    expect(typeof res.body.memory.rssMb).toBe("number");
    expect(res.body.memory.rssMb).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.memory.rssMb)).toBe(true);

    expect(typeof res.body.memory.heapUsedMb).toBe("number");
    expect(res.body.memory.heapUsedMb).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.memory.heapUsedMb)).toBe(true);

    // pid should be a positive integer
    expect(typeof res.body.pid).toBe("number");
    expect(res.body.pid).toBeGreaterThan(0);
    expect(Number.isInteger(res.body.pid)).toBe(true);

    // node should be a version string starting with 'v'
    expect(typeof res.body.node).toBe("string");
    expect(res.body.node).toMatch(/^v\d+\.\d+\.\d+/);
  });
});
