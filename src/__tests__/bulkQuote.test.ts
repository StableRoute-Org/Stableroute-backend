import request from "supertest";
import app from "../index";
import { resetStores } from "../stores";

describe("POST /api/v1/quote/bulk", () => {
  let originalBulkMax: number;

  beforeAll(async () => {
    const cfg = await request(app).get("/api/v1/config");
    originalBulkMax = cfg.body.config.bulkMaxItems;
  });

  afterEach(async () => {
    await request(app)
      .patch("/api/v1/config")
      .send({ bulkMaxItems: originalBulkMax });
    resetStores();
  });

  // ── array-level validation ───────────────────────────────────────────────

  it("returns 400 when items field is missing entirely", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.requestId).toBeTruthy();
  });

  it("returns 400 when items is an empty array", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 when items exceeds default cap of 100", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: new Array(101).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/1-100/);
  });

  it("accepts exactly 100 items (at the default cap boundary)", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: new Array(100).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(100);
  });

  // ── per-item result shape for valid entries ──────────────────────────────

  it("returns ok:true with echoed fields for a valid item", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "USDC", dest_asset: "EURC", amount: "500" }],
      });
    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.index).toBe(0);
    expect(item.ok).toBe(true);
    expect(item.source_asset).toBe("USDC");
    expect(item.dest_asset).toBe("EURC");
    expect(item.amount).toBe("500");
    expect(item.estimated_rate).toBe("1.0");
  });

  it("normalizes asset codes to uppercase", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "usdc", dest_asset: "eurc", amount: "10" }],
      });
    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.ok).toBe(true);
    expect(item.source_asset).toBe("USDC");
    expect(item.dest_asset).toBe("EURC");
  });

  // ── per-item error cases ─────────────────────────────────────────────────

  it("returns ok:false with error invalid_item when source equals dest", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "USDC", dest_asset: "USDC", amount: "100" }],
      });
    expect(res.status).toBe(200);
    const item = res.body.results[0];
    expect(item.index).toBe(0);
    expect(item.ok).toBe(false);
    expect(item.error).toBe("invalid_item");
  });

  it("returns ok:false with error invalid_item for an invalid source asset code", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "", dest_asset: "EURC", amount: "100" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].error).toBe("invalid_item");
  });

  it("returns ok:false with error invalid_item for a source code longer than 12 chars", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "TOOLONGASSETCODE", dest_asset: "EURC", amount: "100" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].error).toBe("invalid_item");
  });

  it("returns ok:false with error invalid_item for a bad amount (zero)", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "USDC", dest_asset: "EURC", amount: "0" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].error).toBe("invalid_item");
  });

  it("returns ok:false with error invalid_item for a non-numeric amount", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [{ source_asset: "USDC", dest_asset: "EURC", amount: "abc" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].error).toBe("invalid_item");
  });

  // ── mixed batch (core requirement from the issue) ────────────────────────

  it("handles a mixed batch: preserves index, ok:true for valid and ok:false for invalid", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [
          { source_asset: "USDC", dest_asset: "EURC", amount: "100" },   // valid
          { source_asset: "XLM",  dest_asset: "XLM",  amount: "50"  },   // same asset
          { source_asset: "USDC", dest_asset: "EURC", amount: "-5"  },   // bad amount
          { source_asset: "",     dest_asset: "EURC", amount: "10"  },   // bad source
          { source_asset: "BTC",  dest_asset: "ETH",  amount: "200" },   // valid
        ],
      });
    expect(res.status).toBe(200);
    const results = res.body.results;
    expect(results).toHaveLength(5);

    expect(results[0]).toMatchObject({ index: 0, ok: true, source_asset: "USDC", dest_asset: "EURC", amount: "100" });
    expect(results[1]).toMatchObject({ index: 1, ok: false, error: "invalid_item" });
    expect(results[2]).toMatchObject({ index: 2, ok: false, error: "invalid_item" });
    expect(results[3]).toMatchObject({ index: 3, ok: false, error: "invalid_item" });
    expect(results[4]).toMatchObject({ index: 4, ok: true, source_asset: "BTC", dest_asset: "ETH", amount: "200" });
  });

  it("handles an all-invalid batch without a 400 (per-item errors, not batch error)", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [
          { source_asset: "USDC", dest_asset: "USDC", amount: "1" },
          { source_asset: "",     dest_asset: "EURC", amount: "1" },
          { source_asset: "XLM",  dest_asset: "EURC", amount: "0" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.results.every((r: { ok: boolean }) => r.ok === false)).toBe(true);
  });

  // ── configurable cap ──────────────────────────────────────────────────────

  it("respects a lowered bulkMaxItems and reports the new limit in the error message", async () => {
    await request(app).patch("/api/v1/config").send({ bulkMaxItems: 3 });

    const over = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: new Array(4).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/1-3/);

    const ok = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: new Array(3).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
    expect(ok.status).toBe(200);
    expect(ok.body.results).toHaveLength(3);
  });

  it("accepts above the default cap after raising bulkMaxItems", async () => {
    await request(app).patch("/api/v1/config").send({ bulkMaxItems: 150 });

    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: new Array(101).fill({ source_asset: "USDC", dest_asset: "EURC", amount: "1" }) });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(101);
  });

  // ── read-only mode ────────────────────────────────────────────────────────

  it("remains accessible in read-only mode", async () => {
    await request(app).post("/api/v1/admin/read-only");

    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: [{ source_asset: "USDC", dest_asset: "EURC", amount: "1" }] });
    expect(res.status).toBe(200);

    await request(app).post("/api/v1/admin/read-write");
  });
});
