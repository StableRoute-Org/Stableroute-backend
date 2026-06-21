import request from "supertest";
import app from "../index";

const registerPair = async (source: string, destination: string) => {
  const res = await request(app)
    .post("/api/v1/pairs")
    .send({ source, destination });
  expect([200, 201]).toContain(res.status);
};

const expectCanonicalError = (
  body: Record<string, unknown>,
  requestId: string,
  error: string
) => {
  expect(body.error).toBe(error);
  expect(body.message).toBeTruthy();
  expect(body.requestId).toBe(requestId);
};

describe("pair-meta endpoints", () => {
  it("returns registered pair info with default metadata before any patch", async () => {
    await registerPair("PMDEF", "PMDST");

    const res = await request(app).get("/api/v1/pairs/PMDEF/PMDST/info");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: "PMDEF",
      destination: "PMDST",
      registered: true,
      feeBps: 0,
      minAmount: "0",
      maxAmount: "0",
      liquidity: "0",
    });
  });

  it("patches fee boundaries and aggregates all metadata in pair info", async () => {
    await registerPair("PMOK", "PMDST");

    const feeZero = await request(app)
      .patch("/api/v1/pairs/PMOK/PMDST/fee_bps")
      .send({ feeBps: 0 });
    expect(feeZero.status).toBe(200);
    expect(feeZero.body.feeBps).toBe(0);

    const feeMax = await request(app)
      .patch("/api/v1/pairs/PMOK/PMDST/fee_bps")
      .send({ feeBps: 1000 });
    expect(feeMax.status).toBe(200);
    expect(feeMax.body.feeBps).toBe(1000);

    const min = await request(app)
      .patch("/api/v1/pairs/PMOK/PMDST/min")
      .send({ minAmount: "0" });
    expect(min.status).toBe(200);
    expect(min.body.minAmount).toBe("0");

    const max = await request(app)
      .patch("/api/v1/pairs/PMOK/PMDST/max")
      .send({ maxAmount: "500" });
    expect(max.status).toBe(200);
    expect(max.body.maxAmount).toBe("500");

    const liquidity = await request(app)
      .patch("/api/v1/pairs/PMOK/PMDST/liquidity")
      .send({ liquidity: "750" });
    expect(liquidity.status).toBe(200);
    expect(liquidity.body.liquidity).toBe("750");

    const info = await request(app).get("/api/v1/pairs/PMOK/PMDST/info");
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      registered: true,
      feeBps: 1000,
      minAmount: "0",
      maxAmount: "500",
      liquidity: "750",
    });
  });

  it.each([
    ["fee above 1000", "fee_bps", { feeBps: 1001 }],
    ["non-integer fee", "fee_bps", { feeBps: 1.5 }],
    ["array fee", "fee_bps", { feeBps: ["10"] }],
    ["leading-zero minAmount", "min", { minAmount: "01" }],
    ["object minAmount", "min", { minAmount: {} }],
    ["zero maxAmount", "max", { maxAmount: "0" }],
    ["array maxAmount", "max", { maxAmount: ["10"] }],
    ["leading-zero liquidity", "liquidity", { liquidity: "01" }],
    ["object liquidity", "liquidity", { liquidity: {} }],
  ])("rejects %s with canonical 400", async (_name, endpoint, body) => {
    await registerPair("PMBAD", "PMDST");
    const requestId = `pair-meta-400-${endpoint}`;

    const res = await request(app)
      .patch(`/api/v1/pairs/PMBAD/PMDST/${endpoint}`)
      .set("X-Request-Id", requestId)
      .send(body);

    expect(res.status).toBe(400);
    expectCanonicalError(res.body, requestId, "invalid_request");
  });

  it.each([
    ["fee_bps", { feeBps: 5 }],
    ["min", { minAmount: "10" }],
    ["max", { maxAmount: "10" }],
    ["liquidity", { liquidity: "10" }],
  ])("returns canonical 404 for unregistered %s patches", async (endpoint, body) => {
    const requestId = `pair-meta-404-${endpoint}`;

    const res = await request(app)
      .patch(`/api/v1/pairs/PMMISS/PMDST/${endpoint}`)
      .set("X-Request-Id", requestId)
      .send(body);

    expect(res.status).toBe(404);
    expectCanonicalError(res.body, requestId, "not_found");
  });

  it("returns unregistered pair info with default metadata", async () => {
    const res = await request(app).get("/api/v1/pairs/PMNONE/PMDST/info");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: "PMNONE",
      destination: "PMDST",
      registered: false,
      feeBps: 0,
      minAmount: "0",
      maxAmount: "0",
      liquidity: "0",
    });
  });
});
