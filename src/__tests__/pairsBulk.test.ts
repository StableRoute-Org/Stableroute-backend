/**
 * Tests for POST /api/v1/pairs/bulk — batch pair-registration endpoint.
 *
 * Covers:
 *  - Top-level array validation (missing, empty, over-cap)
 *  - Mixed valid/invalid batches with per-item results
 *  - All-invalid batch
 *  - Idempotent re-registration (pair.refreshed event)
 *  - Registered pairs appear in GET /api/v1/pairs
 *  - Asset-code normalization (lowercase → uppercase)
 *  - Non-object array items (null, string, number)
 *  - Configurable bulkMaxItems cap
 *  - Read-only mode blocks the endpoint
 *  - Paused mode blocks the endpoint
 *  - Event log recording for registered and refreshed pairs
 *  - requestId included in error responses
 */

import request from "supertest";
import app from "../index";
import { resetStores, setReadOnly, setPaused, eventLog } from "../stores";

describe("POST /api/v1/pairs/bulk", () => {
  let originalBulkMax: number;

  beforeAll(async () => {
    const cfg = await request(app).get("/api/v1/config");
    originalBulkMax = cfg.body.config.bulkMaxItems;
  });

  afterEach(async () => {
    // Restore bulkMaxItems in case a test lowered it
    await request(app)
      .patch("/api/v1/config")
      .set("Content-Type", "application/json")
      .send({ bulkMaxItems: originalBulkMax });
    setReadOnly(false);
    setPaused(false);
    resetStores();
  });

  // ── Top-level array validation ────────────────────────────────────────────

  it("returns 400 when the pairs field is missing entirely", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it("returns 400 when pairs is null", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when pairs is a non-array value", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: "USDC::EURC" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when pairs is an empty array", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it("returns 400 and error message mentioning the cap when pairs exceeds default bulkMaxItems (100)", async () => {
    const over = new Array(101).fill({ source: "USDC", destination: "EURC" });
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: over });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/1-100/);
    expect(res.body.requestId).toBeTruthy();
  });

  it("accepts exactly bulkMaxItems (100) pairs", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      source: `S${String(i).padStart(2, "0")}`,
      destination: `D${String(i).padStart(2, "0")}`,
    }));
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: items });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(100);
    expect(res.body.results.every((r: { ok: boolean }) => r.ok === true)).toBe(true);
  });

  // ── Per-item success ──────────────────────────────────────────────────────

  it("returns 200 with ok:true and full shape for a single valid pair", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      index: 0,
      ok: true,
      source: "USDC",
      destination: "EURC",
      registered: true,
    });
  });

  it("preserves insertion order — index matches position in the request array", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "EURC" },
          { source: "XLM", destination: "USDC" },
          { source: "BTC", destination: "ETH" },
        ],
      });
    expect(res.status).toBe(200);
    const results = res.body.results;
    expect(results[0].index).toBe(0);
    expect(results[1].index).toBe(1);
    expect(results[2].index).toBe(2);
  });

  // ── Asset-code normalization ──────────────────────────────────────────────

  it("normalizes lowercase asset codes to uppercase (same as single endpoint)", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "usdc", destination: "eurc" }] });
    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.ok).toBe(true);
    expect(item.source).toBe("USDC");
    expect(item.destination).toBe("EURC");
  });

  it("normalizes mixed-case codes with surrounding whitespace", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "  Usdc  ", destination: "  Eurc  " }] });
    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.ok).toBe(true);
    expect(item.source).toBe("USDC");
    expect(item.destination).toBe("EURC");
  });

  // ── Per-item error cases ──────────────────────────────────────────────────

  it("returns ok:false with error invalid_asset_code when source is missing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("returns ok:false with error invalid_asset_code when destination is missing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("returns ok:false with error invalid_asset_code when source is empty string", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "", destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("returns ok:false with error invalid_asset_code when source exceeds 12 chars", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "TOOLONGASSET!", destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("returns ok:false with error invalid_asset_code for a code with special characters", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USD$", destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("returns ok:false with error same_asset when source equals destination", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "USDC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "same_asset" });
  });

  it("returns ok:false with error same_asset when source equals destination after normalization", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "usdc", destination: "USDC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "same_asset" });
  });

  // ── Non-object array items ────────────────────────────────────────────────

  it("rejects a null item safely as invalid_asset_code without throwing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [null] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("rejects a string item safely as invalid_asset_code without throwing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: ["USDC::EURC"] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("rejects a number item safely as invalid_asset_code without throwing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [42] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  it("rejects a nested array item safely as invalid_asset_code without throwing", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [["USDC", "EURC"]] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: false, error: "invalid_asset_code" });
  });

  // ── Mixed valid/invalid batch ─────────────────────────────────────────────

  it("handles a mixed batch: processes every item, reports ok:true for valid and ok:false for invalid", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "EURC" },   // valid → ok:true
          { source: "XLM",  destination: "XLM"  },   // same asset → ok:false
          { source: "",     destination: "EURC" },   // bad source → ok:false
          { source: "BTC",  destination: "ETH"  },   // valid → ok:true
          null,                                       // non-object → ok:false
        ],
      });
    expect(res.status).toBe(200);
    const results = res.body.results;
    expect(results).toHaveLength(5);

    expect(results[0]).toMatchObject({ index: 0, ok: true, source: "USDC", destination: "EURC", registered: true });
    expect(results[1]).toMatchObject({ index: 1, ok: false, error: "same_asset" });
    expect(results[2]).toMatchObject({ index: 2, ok: false, error: "invalid_asset_code" });
    expect(results[3]).toMatchObject({ index: 3, ok: true, source: "BTC", destination: "ETH", registered: true });
    expect(results[4]).toMatchObject({ index: 4, ok: false, error: "invalid_asset_code" });
  });

  // ── All-invalid batch ─────────────────────────────────────────────────────

  it("handles an all-invalid batch without returning 400 (per-item errors, not batch error)", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "USDC" },  // same asset
          { source: "",     destination: "EURC" },  // bad source
          { source: "XLM",  destination: "!BAD" },  // bad destination
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results.every((r: { ok: boolean }) => r.ok === false)).toBe(true);
  });

  // ── Idempotent re-registration ────────────────────────────────────────────

  it("returns ok:true for a pair that is already registered (idempotent re-registration)", async () => {
    // First registration via single endpoint
    await request(app)
      .post("/api/v1/pairs")
      .set("Content-Type", "application/json")
      .send({ source: "USDC", destination: "EURC" });

    // Re-register the same pair via bulk
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "EURC" }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ index: 0, ok: true, source: "USDC", destination: "EURC", registered: true });
  });

  it("records pair.refreshed event (not pair.registered) when re-registering an existing pair", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .set("Content-Type", "application/json")
      .send({ source: "USDC", destination: "EURC" });

    const eventsBefore = eventLog.length;

    await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "EURC" }] });

    const newEvents = eventLog.slice(eventsBefore);
    expect(newEvents).toHaveLength(1);
    expect(newEvents[0].type).toBe("pair.refreshed");
    expect(newEvents[0].payload).toMatchObject({ source: "USDC", destination: "EURC" });
  });

  // ── Event log recording ───────────────────────────────────────────────────

  it("records pair.registered event for each newly registered pair", async () => {
    const eventsBefore = eventLog.length;

    await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "EURC" },
          { source: "XLM",  destination: "USDC" },
        ],
      });

    const newEvents = eventLog.slice(eventsBefore);
    expect(newEvents).toHaveLength(2);
    expect(newEvents[0].type).toBe("pair.registered");
    expect(newEvents[0].payload).toMatchObject({ source: "USDC", destination: "EURC" });
    expect(newEvents[1].type).toBe("pair.registered");
    expect(newEvents[1].payload).toMatchObject({ source: "XLM", destination: "USDC" });
  });

  it("does not record events for invalid items", async () => {
    const eventsBefore = eventLog.length;

    await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "USDC" },  // same asset — rejected
          { source: "",     destination: "EURC" },  // invalid code — rejected
        ],
      });

    expect(eventLog.length).toBe(eventsBefore);
  });

  // ── Successful pairs appear in GET /api/v1/pairs ──────────────────────────

  it("successfully registered pairs appear in GET /api/v1/pairs", async () => {
    await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: [
          { source: "USDC", destination: "EURC" },
          { source: "XLM",  destination: "USDC" },
          { source: "USDC", destination: "USDC" }, // invalid — should not appear
        ],
      });

    const listRes = await request(app).get("/api/v1/pairs");
    expect(listRes.status).toBe(200);
    const pairKeys = listRes.body.pairs.map(
      (p: { source: string; destination: string }) => `${p.source}::${p.destination}`
    );
    expect(pairKeys).toContain("USDC::EURC");
    expect(pairKeys).toContain("XLM::USDC");
    // The invalid same-asset pair must not appear
    expect(pairKeys.filter((k: string) => k === "USDC::USDC")).toHaveLength(0);
  });

  // ── Configurable bulkMaxItems cap ────────────────────────────────────────

  it("respects a lowered bulkMaxItems and reflects the new limit in the error message", async () => {
    await request(app)
      .patch("/api/v1/config")
      .set("Content-Type", "application/json")
      .send({ bulkMaxItems: 3 });

    const over = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: new Array(4).fill({ source: "USDC", destination: "EURC" }),
      });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/1-3/);

    const ok = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({
        pairs: Array.from({ length: 3 }, (_, i) => ({
          source: `A${i}`,
          destination: `B${i}`,
        })),
      });
    expect(ok.status).toBe(200);
    expect(ok.body.results).toHaveLength(3);
  });

  it("accepts above the default cap after raising bulkMaxItems", async () => {
    await request(app)
      .patch("/api/v1/config")
      .set("Content-Type", "application/json")
      .send({ bulkMaxItems: 150 });

    const items = Array.from({ length: 101 }, (_, i) => ({
      source: `S${String(i).padStart(3, "0")}`,
      destination: `D${String(i).padStart(3, "0")}`,
    }));
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: items });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(101);
  });

  // ── Read-only mode ────────────────────────────────────────────────────────

  it("returns 503 read_only_mode when read-only mode is active", async () => {
    setReadOnly(true);
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "EURC" }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("read_only_mode");
    expect(res.body.requestId).toBeTruthy();
  });

  // ── Paused mode ───────────────────────────────────────────────────────────

  it("returns 503 service_paused when the service is paused", async () => {
    setPaused(true);
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [{ source: "USDC", destination: "EURC" }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("service_paused");
    expect(res.body.requestId).toBeTruthy();
  });

  // ── Content-Type enforcement ──────────────────────────────────────────────

  it("returns 415 when Content-Type is not application/json", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "text/plain")
      .send('{"pairs":[{"source":"USDC","destination":"EURC"}]}');
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("unsupported_media_type");
  });

  // ── requestId in error responses ─────────────────────────────────────────

  it("includes a requestId in the 400 error response", async () => {
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .send({ pairs: [] });
    expect(res.body.requestId).toBeTruthy();
    expect(typeof res.body.requestId).toBe("string");
  });

  it("echoes a provided X-Request-Id header in error responses", async () => {
    const customId = "test-bulk-req-001";
    const res = await request(app)
      .post("/api/v1/pairs/bulk")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", customId)
      .send({ pairs: [] });
    expect(res.body.requestId).toBe(customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });
});
