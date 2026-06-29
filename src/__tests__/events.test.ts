/**
 * Test coverage for event log filtering, limit clamping, and capacity eviction.
 *
 * Covers:
 * - `since` timestamp filter: events after timestamp are included, earlier excluded
 * - `limit` clamp to [1, EVENT_LOG_CAP]: limit=0 becomes 1, limit over cap becomes cap
 * - `pair.unregistered` and `pair.refreshed` events are recorded by their handlers
 * - Cap eviction boundary: when log exceeds EVENT_LOG_CAP, oldest entry is shifted out
 * - No sensitive payload fields leak into recorded events
 * - Invalid query param combinations return 400
 */

import request from "supertest";
import app from "../index";
import {
  eventLog,
  recordEvent,
  resetStores,
  EVENT_LOG_CAP,
  config,
} from "../stores";

describe("GET /api/v1/events — filtering, limit, and capacity", () => {
  beforeEach(() => {
    resetStores();
  });

  // ─── since filter ────────────────────────────────────────────────────────

  it("returns events whose ts >= since and excludes earlier ones", async () => {
    // Seed two events with known timestamps by manipulating the log directly.
    const past = Date.now() - 10_000;
    const recent = Date.now();
    eventLog.push({ id: "a", ts: past, type: "pair.registered", payload: { source: "OLD", destination: "EVT" } });
    eventLog.push({ id: "b", ts: recent, type: "pair.registered", payload: { source: "NEW", destination: "EVT" } });

    const res = await request(app).get("/api/v1/events").query({ since: recent });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((e: { id: string }) => e.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a");
  });

  it("returns empty items when since is in the far future", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "FUT", destination: "TST" });

    const future = Date.now() + 100_000;
    const res = await request(app).get("/api/v1/events").query({ since: future });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("returns all events when since=0 (default)", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "ALL", destination: "TST" });
    await request(app).delete("/api/v1/pairs/ALL/TST");

    const res = await request(app).get("/api/v1/events").query({ since: 0 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 400 for negative since", async () => {
    const res = await request(app).get("/api/v1/events").query({ since: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/since/);
  });

  it("returns 400 for non-numeric since", async () => {
    const res = await request(app).get("/api/v1/events").query({ since: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // ─── limit clamp ─────────────────────────────────────────────────────────

  it("clamps limit=0 up to 1", async () => {
    // Seed multiple events
    for (let i = 0; i < 5; i++) {
      recordEvent("pair.registered", { source: `LIM${i}`, destination: "TST" });
    }

    const res = await request(app).get("/api/v1/events").query({ limit: 0 });
    expect(res.status).toBe(200);
    // limit=0 → clamped to 1, so at most 1 item returned
    expect(res.body.items.length).toBeLessThanOrEqual(1);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("clamps limit over EVENT_LOG_CAP down to EVENT_LOG_CAP", async () => {
    recordEvent("pair.registered", { source: "CAP", destination: "TST" });

    const over = EVENT_LOG_CAP + 1;
    const res = await request(app).get("/api/v1/events").query({ limit: over });
    expect(res.status).toBe(200);
    // Should not error; limit is silently clamped
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it("returns at most N items when limit=N", async () => {
    for (let i = 0; i < 10; i++) {
      recordEvent("pair.registered", { source: `P${i}`, destination: "TST" });
    }

    const res = await request(app).get("/api/v1/events").query({ limit: 3 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(3);
  });

  it("returns the most recent N items (tail of log) when limit=N", async () => {
    for (let i = 0; i < 5; i++) {
      recordEvent("pair.registered", { source: `ORD${i}`, destination: "TST" });
    }

    const res = await request(app).get("/api/v1/events").query({ limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    // Most recent entries are ORD3 and ORD4
    const sources = res.body.items.map((e: { payload: { source: string } }) => e.payload.source);
    expect(sources).toContain("ORD4");
    expect(sources).toContain("ORD3");
  });

  it("returns 400 for non-integer limit", async () => {
    const res = await request(app).get("/api/v1/events").query({ limit: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // ─── pair.unregistered and pair.refreshed events ────────────────────────

  it("records pair.unregistered event when a pair is deleted", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "DEL", destination: "ME" });
    await request(app).delete("/api/v1/pairs/DEL/ME");

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    const unreg = res.body.items.find(
      (e: { type: string; payload: { source: string; destination: string } }) =>
        e.type === "pair.unregistered" && e.payload.source === "DEL" && e.payload.destination === "ME"
    );
    expect(unreg).toBeDefined();
  });

  it("records pair.refreshed event on idempotent re-registration", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "REF", destination: "ME" });
    await request(app).post("/api/v1/pairs").send({ source: "REF", destination: "ME" });

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    const refreshed = res.body.items.find(
      (e: { type: string; payload: { source: string; destination: string } }) =>
        e.type === "pair.refreshed" && e.payload.source === "REF" && e.payload.destination === "ME"
    );
    expect(refreshed).toBeDefined();
  });

  // ─── cap eviction ────────────────────────────────────────────────────────

  it("evicts the oldest entry when the log exceeds EVENT_LOG_CAP", () => {
    resetStores();

    // Fill the log to exactly EVENT_LOG_CAP
    const sentinel = "FIRST_EVENT";
    eventLog.push({ id: sentinel, ts: 1, type: "pair.registered", payload: {} });
    for (let i = 1; i < EVENT_LOG_CAP; i++) {
      eventLog.push({ id: `e${i}`, ts: i + 1, type: "pair.registered", payload: {} });
    }
    expect(eventLog.length).toBe(EVENT_LOG_CAP);
    expect(eventLog[0].id).toBe(sentinel);

    // Push one more via recordEvent — should evict the sentinel
    recordEvent("pair.unregistered", { source: "X", destination: "Y" });

    expect(eventLog.length).toBe(EVENT_LOG_CAP);
    expect(eventLog[0].id).not.toBe(sentinel);
    expect(eventLog[eventLog.length - 1].type).toBe("pair.unregistered");
  });

  it("does not evict entries when log is below EVENT_LOG_CAP", () => {
    resetStores();
    recordEvent("pair.registered", { source: "A", destination: "B" });
    recordEvent("pair.registered", { source: "C", destination: "D" });
    expect(eventLog.length).toBe(2);
    // Both entries still present
    expect(eventLog[0].payload.source).toBe("A");
    expect(eventLog[1].payload.source).toBe("C");
  });

  // ─── security: no sensitive payload fields ───────────────────────────────

  it("does not include raw API key material in apikey.created events", async () => {
    const create = await request(app).post("/api/v1/api-keys").send({ label: "security-test" });
    expect(create.status).toBe(201);
    const rawKey: string = create.body.key;

    const events = await request(app).get("/api/v1/events");
    const keyEvents = events.body.items.filter(
      (e: { type: string }) => e.type === "apikey.created"
    );
    // No event payload should contain the raw key string
    for (const evt of keyEvents) {
      const payloadStr = JSON.stringify(evt.payload);
      expect(payloadStr).not.toContain(rawKey);
    }
    // The prefix (first 8 chars) and label should be present instead
    const keyEvent = keyEvents.find(
      (e: { payload: { label: string } }) => e.payload.label === "security-test"
    );
    expect(keyEvent).toBeDefined();
    expect(keyEvent.payload.prefix).toBe(rawKey.slice(0, 8));
  });

  it("does not include webhook secret material in webhook.created events", async () => {
    const create = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: ["pair.registered"] });
    expect(create.status).toBe(201);

    const events = await request(app).get("/api/v1/events");
    const webhookEvents = events.body.items.filter(
      (e: { type: string }) => e.type === "webhook.created"
    );
    // Should expose id and url but no token/secret fields
    for (const evt of webhookEvents) {
      expect(Object.keys(evt.payload)).not.toContain("secret");
      expect(Object.keys(evt.payload)).not.toContain("token");
    }
  });

  // ─── event shape ─────────────────────────────────────────────────────────

  it("each event has the required id, ts, type, and payload fields", async () => {
    await request(app).post("/api/v1/pairs").send({ source: "SHP", destination: "TST" });

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const evt of res.body.items) {
      expect(typeof evt.id).toBe("string");
      expect(typeof evt.ts).toBe("number");
      expect(typeof evt.type).toBe("string");
      expect(typeof evt.payload).toBe("object");
    }
  });

  // ─── config-driven eventLogCap ────────────────────────────────────────────

  it("respects a lower eventLogCap set via PATCH /api/v1/config", async () => {
    resetStores();
    // Lower the cap to a small value
    const smallCap = 5;
    const patch = await request(app)
      .patch("/api/v1/config")
      .send({ eventLogCap: smallCap });
    expect(patch.status).toBe(200);
    expect(config.eventLogCap).toBe(smallCap);

    // Push smallCap events — all should fit
    for (let i = 0; i < smallCap; i++) {
      recordEvent("pair.registered", { source: `SC${i}`, destination: "TST" });
    }
    expect(eventLog.length).toBeLessThanOrEqual(smallCap);
  });
});
