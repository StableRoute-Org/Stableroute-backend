/**
 * Tests for durable pause state (issue #29).
 *
 * Verifies that:
 * - pause state is persisted to the state file when setPaused(true) is called
 * - unpause removes the state file
 * - loadPausedState() correctly restores state from the file (simulating a restart)
 * - admin.paused / admin.unpaused events are recorded
 * - the restored state is reflected in /api/v1/admin/status, deep health, and metrics
 */

process.env.PAUSE_STATE_FILE = ".pause_state_test.json";

import request from "supertest";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import app from "../index";
import { resetStores, paused, setPaused, eventLog } from "../stores";
import {
  loadPausedState,
  savePausedState,
  pauseStateFilePath,
} from "../pauseState";

const stateFile = pauseStateFilePath();

// Ensure a clean slate before and after each test.
beforeEach(() => {
  resetStores();
  try {
    unlinkSync(stateFile);
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  resetStores();
  try {
    unlinkSync(stateFile);
  } catch {
    /* ignore */
  }
});

describe("Durable pause state — persistence helpers", () => {
  it("loadPausedState() returns false when file does not exist", () => {
    expect(existsSync(stateFile)).toBe(false);
    expect(loadPausedState()).toBe(false);
  });

  it("savePausedState(true) writes a file that loadPausedState() reads back as true", () => {
    savePausedState(true);
    expect(existsSync(stateFile)).toBe(true);
    expect(loadPausedState()).toBe(true);
  });

  it("savePausedState(false) removes the file", () => {
    savePausedState(true);
    expect(existsSync(stateFile)).toBe(true);
    savePausedState(false);
    expect(existsSync(stateFile)).toBe(false);
  });

  it("loadPausedState() returns false when file contains malformed JSON", () => {
    writeFileSync(stateFile, "{not json}", "utf8");
    expect(loadPausedState()).toBe(false);
  });

  it("loadPausedState() returns false when file contains valid JSON but no paused field", () => {
    writeFileSync(stateFile, JSON.stringify({ foo: "bar" }), "utf8");
    expect(loadPausedState()).toBe(false);
  });

  it("loadPausedState() returns false when paused field is not a boolean", () => {
    writeFileSync(stateFile, JSON.stringify({ paused: 1 }), "utf8");
    expect(loadPausedState()).toBe(false);
  });
});

describe("Durable pause state — setPaused persists", () => {
  it("setPaused(true) writes the state file", () => {
    setPaused(true);
    expect(existsSync(stateFile)).toBe(true);
    expect(loadPausedState()).toBe(true);
  });

  it("setPaused(false) removes the state file", () => {
    setPaused(true);
    setPaused(false);
    expect(existsSync(stateFile)).toBe(false);
  });

  it("in-process paused variable is updated by setPaused", () => {
    setPaused(true);
    expect(paused).toBe(true);
    setPaused(false);
    expect(paused).toBe(false);
  });
});

describe("Durable pause state — simulated restart", () => {
  it("loadPausedState() returns true when file contains paused:true (simulates restart)", () => {
    // Simulate a previous process that paused before exiting.
    savePausedState(true);
    // A fresh call to loadPausedState() mimics the module-load initialisation.
    expect(loadPausedState()).toBe(true);
  });

  it("loadPausedState() returns false after unpause (no file present)", () => {
    savePausedState(true);
    savePausedState(false);
    expect(loadPausedState()).toBe(false);
  });
});

describe("Durable pause state — audit events", () => {
  beforeEach(() => resetStores());

  it("POST /api/v1/admin/pause records an admin.paused event", async () => {
    const res = await request(app).post("/api/v1/admin/pause");
    expect(res.status).toBe(200);
    expect(eventLog.some((e) => e.type === "admin.paused")).toBe(true);
  });

  it("POST /api/v1/admin/unpause records an admin.unpaused event", async () => {
    await request(app).post("/api/v1/admin/pause");
    const res = await request(app).post("/api/v1/admin/unpause");
    expect(res.status).toBe(200);
    expect(eventLog.some((e) => e.type === "admin.unpaused")).toBe(true);
  });

  it("events endpoint surfaces admin.paused and admin.unpaused events", async () => {
    await request(app).post("/api/v1/admin/pause");
    await request(app).post("/api/v1/admin/unpause");
    const events = await request(app).get("/api/v1/events");
    const types = events.body.items.map((e: { type: string }) => e.type);
    expect(types).toContain("admin.paused");
    expect(types).toContain("admin.unpaused");
  });
});

describe("Durable pause state — state reflected in status/health/metrics", () => {
  beforeEach(() => resetStores());

  afterEach(async () => {
    await request(app).post("/api/v1/admin/unpause");
  });

  it("/api/v1/admin/status reflects paused:true after pause", async () => {
    await request(app).post("/api/v1/admin/pause");
    const res = await request(app).get("/api/v1/admin/status");
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
  });

  it("/api/v1/health/deep returns status:paused when paused", async () => {
    await request(app).post("/api/v1/admin/pause");
    const res = await request(app).get("/api/v1/health/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("paused");
  });

  it("/api/v1/metrics reports stableroute_paused 1 when paused", async () => {
    await request(app).post("/api/v1/admin/pause");
    const res = await request(app).get("/api/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^stableroute_paused 1$/m);
  });

  it("/api/v1/metrics reports stableroute_paused 0 after unpause", async () => {
    await request(app).post("/api/v1/admin/pause");
    await request(app).post("/api/v1/admin/unpause");
    const res = await request(app).get("/api/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^stableroute_paused 0$/m);
  });
});
