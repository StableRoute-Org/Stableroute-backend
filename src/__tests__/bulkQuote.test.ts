import request from "supertest";
import app from "../index";

const postBulkQuote = (items?: unknown) =>
  request(app)
    .post("/api/v1/quote/bulk")
    .send(items === undefined ? {} : { items });

describe("POST /api/v1/quote/bulk", () => {
  it("rejects missing, empty, and over-cap item arrays", async () => {
    const missing = await postBulkQuote();
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({
      error: "invalid_request",
      message: "items must be 1-100 entries",
    });
    expect(missing.body.requestId).toBeTruthy();

    const empty = await postBulkQuote([]);
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({
      error: "invalid_request",
      message: "items must be 1-100 entries",
    });

    const tooMany = await postBulkQuote(
      Array.from({ length: 101 }, () => ({
        source_asset: "USDC",
        dest_asset: "EURC",
        amount: "1",
      }))
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe("items must be 1-100 entries");
  });

  it("accepts the 100-item boundary and preserves each valid item result", async () => {
    const items = Array.from({ length: 100 }, (_unused, index) => ({
      source_asset: "USDC",
      dest_asset: index % 2 === 0 ? "EURC" : "XLM",
      amount: String(index + 1),
    }));

    const res = await postBulkQuote(items);
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(100);
    expect(res.body.results[0]).toEqual({
      index: 0,
      ok: true,
      source_asset: "USDC",
      dest_asset: "EURC",
      amount: "1",
      estimated_rate: "1.0",
    });
    expect(res.body.results[99]).toEqual({
      index: 99,
      ok: true,
      source_asset: "USDC",
      dest_asset: "XLM",
      amount: "100",
      estimated_rate: "1.0",
    });
  });

  it("returns per-item outcomes for mixed valid and invalid entries", async () => {
    const res = await postBulkQuote([
      { source_asset: "USDC", dest_asset: "EURC", amount: "100" },
      { source_asset: "USDC", dest_asset: "USDC", amount: "25" },
      { source_asset: "XLM", dest_asset: "EURC", amount: "0" },
      { source_asset: "TOO_LONG_ASSET", dest_asset: "EURC", amount: "10" },
      { source_asset: "XLM", dest_asset: "USDC", amount: "50" },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      {
        index: 0,
        ok: true,
        source_asset: "USDC",
        dest_asset: "EURC",
        amount: "100",
        estimated_rate: "1.0",
      },
      { index: 1, ok: false, error: "invalid_item" },
      { index: 2, ok: false, error: "invalid_item" },
      { index: 3, ok: false, error: "invalid_item" },
      {
        index: 4,
        ok: true,
        source_asset: "XLM",
        dest_asset: "USDC",
        amount: "50",
        estimated_rate: "1.0",
      },
    ]);
  });

  it("returns indexed invalid_item results for an all-invalid batch", async () => {
    const res = await postBulkQuote([
      { source_asset: "USDC", dest_asset: "USDC", amount: "100" },
      { source_asset: "USDC", dest_asset: "EURC", amount: "01" },
      { source_asset: "", dest_asset: "EURC", amount: "5" },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { index: 0, ok: false, error: "invalid_item" },
      { index: 1, ok: false, error: "invalid_item" },
      { index: 2, ok: false, error: "invalid_item" },
    ]);
  });
});
