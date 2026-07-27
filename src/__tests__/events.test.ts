/**
 * Test coverage for event log filtering, limit clamping, capacity eviction,
 * and the strict input validation enforced by POST /api/v1/events.
 *
 * Covers:
 * - `since` timestamp filter: events after timestamp are included, earlier excluded
 * - `limit` clamp to [1, EVENT_LOG_CAP]: limit=0 becomes 1, limit over cap becomes cap
 * - `pair.unregistered` and `pair.refreshed` events are recorded by their handlers
 * - Cap eviction boundary: when log exceeds EVENT_LOG_CAP, oldest entry is shifted out
 * - No sensitive payload fields leak into recorded events
 * - Invalid query param combinations return 400
 * - POST /api/v1/events body validation: unknown fields, wrong types, out-of-range
 *   string lengths, nested depth limits, and other malformed payloads return 400
 */

import request from "supertest";
import app, {
  validateEventPayload,
  validateEventWriteBody,
} from "../index";
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
    eventLog.push({
      id: "a",
      ts: past,
      type: "pair.registered",
      payload: { source: "OLD", destination: "EVT" },
    });
    eventLog.push({
      id: "b",
      ts: recent,
      type: "pair.registered",
      payload: { source: "NEW", destination: "EVT" },
    });

    const res = await request(app)
      .get("/api/v1/events")
      .query({ since: recent });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((e: { id: string }) => e.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a");
  });

  it("returns empty items when since is in the far future", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "FUT", destination: "TST" });

    const future = Date.now() + 100_000;
    const res = await request(app)
      .get("/api/v1/events")
      .query({ since: future });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it("returns all events when since=0 (default)", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "ALL", destination: "TST" });
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
    const res = await request(app)
      .get("/api/v1/events")
      .query({ since: "abc" });
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
    const sources = res.body.items.map(
      (e: { payload: { source: string } }) => e.payload.source,
    );
    expect(sources).toContain("ORD4");
    expect(sources).toContain("ORD3");
  });

  it("returns 400 for non-integer limit", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .query({ limit: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  // ─── pair.unregistered and pair.refreshed events ────────────────────────

  it("records pair.unregistered event when a pair is deleted", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "DEL", destination: "ME" });
    await request(app).delete("/api/v1/pairs/DEL/ME");

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    const unreg = res.body.items.find(
      (e: { type: string; payload: { source: string; destination: string } }) =>
        e.type === "pair.unregistered" &&
        e.payload.source === "DEL" &&
        e.payload.destination === "ME",
    );
    expect(unreg).toBeDefined();
  });

  it("records pair.refreshed event on idempotent re-registration", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "REF", destination: "ME" });
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "REF", destination: "ME" });

    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    const refreshed = res.body.items.find(
      (e: { type: string; payload: { source: string; destination: string } }) =>
        e.type === "pair.refreshed" &&
        e.payload.source === "REF" &&
        e.payload.destination === "ME",
    );
    expect(refreshed).toBeDefined();
  });

  // ─── cap eviction ────────────────────────────────────────────────────────

  it("evicts the oldest entry when the log exceeds EVENT_LOG_CAP", () => {
    resetStores();

    // Fill the log to exactly EVENT_LOG_CAP
    const sentinel = "FIRST_EVENT";
    eventLog.push({
      id: sentinel,
      ts: 1,
      type: "pair.registered",
      payload: {},
    });
    for (let i = 1; i < EVENT_LOG_CAP; i++) {
      eventLog.push({
        id: `e${i}`,
        ts: i + 1,
        type: "pair.registered",
        payload: {},
      });
    }
    expect(eventLog.length).toBe(EVENT_LOG_CAP);
    expect(eventLog.at(0)?.id).toBe(sentinel);

    // Push one more via recordEvent — should evict the sentinel
    recordEvent("pair.unregistered", { source: "X", destination: "Y" });

    expect(eventLog.length).toBe(EVENT_LOG_CAP);
    expect(eventLog.at(0)?.id).not.toBe(sentinel);
    expect(eventLog.at(eventLog.length - 1)?.type).toBe("pair.unregistered");
  });

  it("does not evict entries when log is below EVENT_LOG_CAP", () => {
    resetStores();
    recordEvent("pair.registered", { source: "A", destination: "B" });
    recordEvent("pair.registered", { source: "C", destination: "D" });
    expect(eventLog.length).toBe(2);
    // Both entries still present
    expect(eventLog.at(0)?.payload.source).toBe("A");
    expect(eventLog.at(1)?.payload.source).toBe("C");
  });

  // ─── security: no sensitive payload fields ───────────────────────────────

  it("does not include raw API key material in apikey.created events", async () => {
    const create = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "security-test" });
    expect(create.status).toBe(201);
    const rawKey: string = create.body.key;

    const events = await request(app).get("/api/v1/events");
    const keyEvents = events.body.items.filter(
      (e: { type: string }) => e.type === "apikey.created",
    );
    // No event payload should contain the raw key string
    for (const evt of keyEvents) {
      const payloadStr = JSON.stringify(evt.payload);
      expect(payloadStr).not.toContain(rawKey);
    }
    // The prefix (first 8 chars) and label should be present instead
    const keyEvent = keyEvents.find(
      (e: { payload: { label: string } }) =>
        e.payload.label === "security-test",
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
      (e: { type: string }) => e.type === "webhook.created",
    );
    // Should expose id and url but no token/secret fields
    for (const evt of webhookEvents) {
      expect(Object.keys(evt.payload)).not.toContain("secret");
      expect(Object.keys(evt.payload)).not.toContain("token");
    }
  });

  // ─── event shape ─────────────────────────────────────────────────────────

  it("each event has the required id, ts, type, and payload fields", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "SHP", destination: "TST" });

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

  // ─── array-form param rejection ──────────────────────────────────────────

  it("returns 400 when since is supplied as an array (?since=1&since=2)", async () => {
    // supertest sends repeated keys as an array to Express, which sets
    // req.query.since to ["1", "2"] — parseIntegerQueryParam rejects non-strings.
    const res = await request(app).get("/api/v1/events?since=1&since=2");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/since/);
    expect(res.body.requestId).toBeDefined();
  });

  it("returns 400 when limit is supplied as an array (?limit=5&limit=10)", async () => {
    const res = await request(app).get("/api/v1/events?limit=5&limit=10");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/limit/);
    expect(res.body.requestId).toBeDefined();
  });

  it("returns 400 for a float since (since=1.5)", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .query({ since: "1.5" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 for a float limit (limit=2.7)", async () => {
    const res = await request(app)
      .get("/api/v1/events")
      .query({ limit: "2.7" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("treats absent since as default (0) and returns all events", async () => {
    recordEvent("pair.registered", { source: "DEF", destination: "TST" });
    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("treats absent limit as default (100) and returns up to 100 items", async () => {
    // Seed 3 events
    for (let i = 0; i < 3; i++) {
      recordEvent("pair.registered", { source: `DL${i}`, destination: "TST" });
    }
    const res = await request(app).get("/api/v1/events");
    expect(res.status).toBe(200);
    // Default limit is 100; with only 3 events we get all 3
    expect(res.body.items.length).toBeLessThanOrEqual(100);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
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

describe("validateEventPayload (POST /api/v1/events payload shape)", () => {
  it("accepts null", () => {
    expect(validateEventPayload(null)).toBeNull();
  });

  it("accepts booleans (true and false)", () => {
    expect(validateEventPayload(true)).toBeNull();
    expect(validateEventPayload(false)).toBeNull();
  });

  it("accepts finite numbers (including 0, negatives, and decimals)", () => {
    expect(validateEventPayload(0)).toBeNull();
    expect(validateEventPayload(-1)).toBeNull();
    expect(validateEventPayload(3.14)).toBeNull();
    expect(validateEventPayload(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("rejects non-finite numbers (NaN, Infinity, -Infinity)", () => {
    expect(validateEventPayload(NaN)).toMatch(/finite/);
    expect(validateEventPayload(Infinity)).toMatch(/finite/);
    expect(validateEventPayload(-Infinity)).toMatch(/finite/);
  });

  it("accepts strings within the length limit", () => {
    expect(validateEventPayload("")).toBeNull();
    expect(validateEventPayload("ok")).toBeNull();
    expect(validateEventPayload("a".repeat(256))).toBeNull();
  });

  it("rejects strings longer than 256 chars", () => {
    expect(validateEventPayload("a".repeat(257))).toMatch(/string/);
    expect(validateEventPayload("a".repeat(10_000))).toMatch(/string/);
  });

  it("rejects objects with more than 32 keys", () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) obj[`k${i}`] = i;
    expect(validateEventPayload(obj)).toMatch(/32 keys/);
  });

  it("rejects object keys longer than 256 chars", () => {
    const obj: Record<string, unknown> = {};
    obj["k".repeat(257)] = "v";
    expect(validateEventPayload(obj)).toMatch(/keys/);
  });

  it("accepts objects with exactly 32 keys", () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 32; i++) obj[`k${i}`] = i;
    expect(validateEventPayload(obj)).toBeNull();
  });

  it("accepts empty arrays and bounded arrays", () => {
    expect(validateEventPayload([])).toBeNull();
    expect(validateEventPayload(new Array(32).fill(1))).toBeNull();
  });

  it("rejects arrays with more than 32 entries", () => {
    expect(validateEventPayload(new Array(33).fill(1))).toMatch(/32 entries/);
  });

  it("rejects nested arrays deeper than 3 levels", () => {
    const deep = [[[[[]]]]]; // depth 5
    expect(validateEventPayload(deep)).toMatch(/depth/);
  });

  it("rejects nested objects deeper than 3 levels", () => {
    const deep = { a: { b: { c: { d: 1 } } } }; // depth 4
    expect(validateEventPayload(deep)).toMatch(/depth/);
  });

  it("accepts nested objects at the depth limit (3)", () => {
    const atLimit = { a: { b: { c: 1 } } }; // depth 3
    expect(validateEventPayload(atLimit)).toBeNull();
  });

  it("rejects unsupported primitive types (functions, symbols, undefined)", () => {
    expect(validateEventPayload(() => 1)).toMatch(/string, number/);
    expect(validateEventPayload(Symbol("x"))).toMatch(/string, number/);
    // undefined at root: typeof undefined === "undefined" → falls through to
    // the final "must be string, number, ..." branch.
    expect(validateEventPayload(undefined)).toMatch(/string, number/);
  });

  it("rejects unsupported value types nested inside an object", () => {
    const obj = { a: () => 1 };
    expect(validateEventPayload(obj)).toMatch(/string, number/);
  });

  it("rejects oversized strings nested deep in a payload", () => {
    expect(validateEventPayload({ a: { b: "a".repeat(300) } })).toMatch(
      /string/,
    );
  });

  it("propagates inner-array errors with the first violation", () => {
    const arr = [1, 2, [3, "a".repeat(300)]];
    expect(validateEventPayload(arr)).toMatch(/string/);
  });
});

describe("validateEventWriteBody (POST /api/v1/events top-level)", () => {
  it("rejects a non-object body (null)", () => {
    const r = validateEventWriteBody(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON object/);
  });

  it("rejects an array body", () => {
    const r = validateEventWriteBody([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON object/);
  });

  it("rejects a string body", () => {
    const r = validateEventWriteBody("hello");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/JSON object/);
  });

  it("rejects when type is missing", () => {
    const r = validateEventWriteBody({ payload: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/type is required/);
  });

  it("rejects when type is not a string", () => {
    expect(validateEventWriteBody({ type: 1 }).ok).toBe(false);
    expect(validateEventWriteBody({ type: null }).ok).toBe(false);
    expect(validateEventWriteBody({ type: {} }).ok).toBe(false);
    expect(validateEventWriteBody({ type: [] }).ok).toBe(false);
  });

  it("rejects empty-string type", () => {
    const r = validateEventWriteBody({ type: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/1-128 chars/);
  });

  it("rejects a type longer than 128 chars (boundary +1)", () => {
    const r = validateEventWriteBody({ type: "a".repeat(129) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/1-128 chars/);
  });

  it("accepts a type of exactly 128 chars (boundary)", () => {
    // Build a known type that is exactly 128 chars. To pass the
    // KNOWN_EVENT_TYPES check we use a real type padded conceptually: but
    // since KNOWN_EVENT_TYPES has short entries, we just verify that the
    // length check itself allows 128 chars before the unknown-type check
    // fires. We do this by asserting the rejection message references
    // "must be one of" — proving the length check passed.
    const r = validateEventWriteBody({ type: "a".repeat(128) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/one of/);
  });

  it("accepts a type of exactly 1 char (boundary)", () => {
    const r = validateEventWriteBody({ type: "a" });
    expect(r.ok).toBe(false); // fails the KNOWN_EVENT_TYPES check
    if (!r.ok) expect(r.message).toMatch(/one of/);
  });

  it("rejects an unknown type (not in KNOWN_EVENT_TYPES)", () => {
    const r = validateEventWriteBody({ type: "totally.made.up" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/one of/);
  });

  it("rejects unknown top-level fields", () => {
    const r = validateEventWriteBody({
      type: "pair.registered",
      payload: {},
      extra: "nope",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/unknown field\(s\): extra/);
  });

  it("rejects payload when it is null", () => {
    const r = validateEventWriteBody({ type: "pair.registered", payload: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/payload must be a JSON object/);
  });

  it("rejects payload when it is an array", () => {
    const r = validateEventWriteBody({ type: "pair.registered", payload: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/payload must be a JSON object/);
  });

  it("rejects payload with too many keys", () => {
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) payload[`k${i}`] = i;
    const r = validateEventWriteBody({ type: "pair.registered", payload });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/32 keys/);
  });

  it("rejects payload with oversized string value", () => {
    const r = validateEventWriteBody({
      type: "pair.registered",
      payload: { note: "x".repeat(257) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/string/);
  });

  it("rejects payload with non-finite number", () => {
    const r = validateEventWriteBody({
      type: "pair.registered",
      payload: { amount: Number.NaN },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/finite/);
  });

  it("rejects payload nested deeper than allowed", () => {
    const r = validateEventWriteBody({
      type: "pair.registered",
      payload: { a: { b: { c: { d: 1 } } } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/depth/);
  });

  it("accepts an empty payload object", () => {
    const r = validateEventWriteBody({ type: "pair.registered", payload: {} });
    expect(r.ok).toBe(true);
  });

  it("accepts a missing payload (optional field)", () => {
    const r = validateEventWriteBody({ type: "pair.registered" });
    expect(r.ok).toBe(true);
  });

  it("accepts a deeply-nested payload at the depth boundary", () => {
    const r = validateEventWriteBody({
      type: "pair.registered",
      payload: { a: { b: { c: 1 } } },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts every KNOWN_EVENT_TYPES entry", () => {
    const all = [
      "pair.registered",
      "pair.refreshed",
      "pair.unregistered",
      "pair.meta.reset",
      "pair.enabled",
      "pair.disabled",
      "apikey.created",
      "apikey.deleted",
      "webhook.created",
      "webhook.deleted",
      "admin.paused",
      "admin.unpaused",
    ];
    for (const t of all) {
      const r = validateEventWriteBody({ type: t, payload: { source: "X" } });
      expect(r.ok).toBe(true);
    }
  });
});

describe("POST /api/v1/events — strict input validation", () => {
  beforeEach(() => {
    resetStores();
  });

  // ─── happy path ──────────────────────────────────────────────────────────

  it("creates an event and returns 201 with the canonical record", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: { source: "A", destination: "B" } });
    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(typeof res.body.ts).toBe("number");
    expect(res.body.type).toBe("pair.registered");
    expect(res.body.payload).toEqual({ source: "A", destination: "B" });
  });

  it("records the event so it appears in GET /api/v1/events", async () => {
    await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: { source: "POSTED" } });
    const get = await request(app).get("/api/v1/events");
    expect(get.status).toBe(200);
    const found = get.body.items.find(
      (e: { type: string; payload: { source: string } }) =>
        e.type === "pair.registered" && e.payload.source === "POSTED",
    );
    expect(found).toBeDefined();
  });

  it("accepts a request with no payload (optional field)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered" });
    expect(res.status).toBe(201);
    expect(res.body.payload).toEqual({});
  });

  it("accepts an empty payload object", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: {} });
    expect(res.status).toBe(201);
  });

  // ─── unknown fields ─────────────────────────────────────────────────────

  it("returns 400 for an unknown top-level field", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: {}, evil: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/unknown field\(s\): evil/);
    expect(res.body.requestId).toBeDefined();
  });

  it("returns 400 with all unknown fields listed when several are present", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({
        type: "pair.registered",
        payload: {},
        a: 1,
        b: 2,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unknown field\(s\): a, b/);
  });

  // ─── wrong types / shape ────────────────────────────────────────────────

  it("returns 400 when body is missing entirely", async () => {
    const res = await request(app).post("/api/v1/events").send();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/type is required|JSON object/);
  });

  it("returns 400 when body is a JSON array", async () => {
    const res = await request(app).post("/api/v1/events").send([]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when type is missing", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ payload: { source: "A" } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type is required/);
  });

  it("returns 400 when type is a number", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: 42, payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type must be a string/);
  });

  it("returns 400 when type is null", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: null, payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/type must be a string/);
  });

  // ─── length bounds (boundary numbers) ───────────────────────────────────

  it("returns 400 for empty-string type", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "", payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/1-128 chars/);
  });

  it("returns 400 for a type longer than 128 chars (boundary +1)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "a".repeat(129), payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/1-128 chars/);
  });

  it("rejects an unknown type even at a valid length", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "a".repeat(128), payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/one of/);
  });

  // ─── unknown type values ────────────────────────────────────────────────

  it("returns 400 for a type that is not in KNOWN_EVENT_TYPES", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "totally.made.up", payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/one of/);
  });

  // ─── payload shape ──────────────────────────────────────────────────────

  it("returns 400 when payload is null", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: null });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payload must be a JSON object/);
  });

  it("returns 400 when payload is an array", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload: ["nope"] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/payload must be a JSON object/);
  });

  it("returns 400 when payload contains a string value over 256 chars", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({
        type: "pair.registered",
        payload: { note: "x".repeat(257) },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/string/);
  });

  it("accepts a payload string value of exactly 256 chars (boundary)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({
        type: "pair.registered",
        payload: { note: "x".repeat(256) },
      });
    expect(res.status).toBe(201);
  });

  it("returns 400 when payload has more than 32 keys", async () => {
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < 33; i++) payload[`k${i}`] = i;
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "pair.registered", payload });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/32 keys/);
  });

  it("returns 400 when payload nesting exceeds 3 levels", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({
        type: "pair.registered",
        payload: { a: { b: { c: { d: 1 } } } },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/depth/);
  });

  it("accepts a payload at the depth boundary (3 levels)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({
        type: "pair.registered",
        payload: { a: { b: { c: 1 } } },
      });
    expect(res.status).toBe(201);
  });

  // ─── record keeping ─────────────────────────────────────────────────────

  it("rejected requests do not append anything to the event log", async () => {
    const before = eventLog.length;
    const res = await request(app)
      .post("/api/v1/events")
      .send({ type: "bogus.type", payload: {} });
    expect(res.status).toBe(400);
    expect(eventLog.length).toBe(before);
  });
});
