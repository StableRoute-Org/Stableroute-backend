import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

const originalStateFile = process.env.STABLEROUTE_STATE_FILE;
let tempDir: string;
let stateFile: string;

const loadApp = async () => (await import("../index")).default;

beforeEach(() => {
  jest.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), "stableroute-pause-"));
  stateFile = join(tempDir, "state.json");
  process.env.STABLEROUTE_STATE_FILE = stateFile;
});

afterEach(() => {
  jest.resetModules();
  if (originalStateFile === undefined) {
    delete process.env.STABLEROUTE_STATE_FILE;
  } else {
    process.env.STABLEROUTE_STATE_FILE = originalStateFile;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("durable pause state", () => {
  it("restores a persisted pause state on startup", async () => {
    writeFileSync(stateFile, `${JSON.stringify({ paused: true })}\n`);
    const app = await loadApp();

    const status = await request(app).get("/api/v1/admin/status");
    expect(status.body.paused).toBe(true);

    const deepHealth = await request(app).get("/api/v1/health/deep");
    expect(deepHealth.body.status).toBe("paused");

    const metrics = await request(app).get("/api/v1/metrics");
    expect(metrics.text).toContain("stableroute_paused 1");

    const blocked = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "RST", destination: "PAU" });
    expect(blocked.status).toBe(503);
  });

  it("persists pause and unpause changes", async () => {
    const app = await loadApp();

    const pause = await request(app).post("/api/v1/admin/pause");
    expect(pause.body.paused).toBe(true);
    expect(JSON.parse(readFileSync(stateFile, "utf8")).paused).toBe(true);

    const unpause = await request(app).post("/api/v1/admin/unpause");
    expect(unpause.body.paused).toBe(false);
    expect(JSON.parse(readFileSync(stateFile, "utf8")).paused).toBe(false);
  });
});
