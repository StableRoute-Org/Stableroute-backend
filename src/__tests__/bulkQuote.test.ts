import request from "supertest";
import app from "../index";

const validItem = (amount: number) => ({
  source_asset: "USDC",
  dest_asset: "EURC",
  amount: String(amount),
});

describe("POST /api/v1/quote/bulk", () => {
  it.each([
    ["missing items", {}],
    ["empty items", { items: [] }],
    ["more than 100 items", { items: Array.from({ length: 101 }, () => validItem(1)) }],
  ])("rejects %s", async (_name, body) => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "invalid_request",
      message: "items must be 1-100 entries",
    });
    expect(res.body.requestId).toBeTruthy();
  });

  it("accepts exactly 100 valid quote items", async () => {
    const items = Array.from({ length: 100 }, (_value, index) => validItem(index + 1));

    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items });

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
      dest_asset: "EURC",
      amount: "100",
      estimated_rate: "1.0",
    });
    expect(res.body.results.every((result: { ok: boolean }) => result.ok)).toBe(true);
  });

  it("returns indexed per-item results for mixed valid and invalid entries", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [
          { source_asset: "USDC", dest_asset: "EURC", amount: "100" },
          { source_asset: "TOO_LONG_ASSET", dest_asset: "EURC", amount: "100" },
          { source_asset: "USDC", dest_asset: "USDC", amount: "100" },
          { source_asset: "XLM", dest_asset: "USDC", amount: "0" },
          { source_asset: "XLM", dest_asset: "USDC", amount: "250" },
        ],
      });

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
        amount: "250",
        estimated_rate: "1.0",
      },
    ]);
  });

  it("keeps an all-invalid batch at item level instead of rejecting the request", async () => {
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({
        items: [
          {},
          { source_asset: "USDC", dest_asset: "EURC", amount: "001" },
          { source_asset: "EURC", dest_asset: "EURC", amount: "10" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { index: 0, ok: false, error: "invalid_item" },
      { index: 1, ok: false, error: "invalid_item" },
      { index: 2, ok: false, error: "invalid_item" },
    ]);
  });
});
