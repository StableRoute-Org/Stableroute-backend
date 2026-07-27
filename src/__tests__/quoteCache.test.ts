import request from "supertest";
import app from "../index";
import { resetStores } from "../stores";
import { resetQuoteCache } from "../index";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Quote Cache Lifecycle", () => {
  beforeEach(async () => {
    resetStores();
    resetQuoteCache();
    // Default config values should be restored
    await request(app).patch("/api/v1/config").send({ quote_ttl_ms: 30000 });
  });

  afterEach(() => {
    resetStores();
    resetQuoteCache();
  });

  it("handles basic caching hits and misses", async () => {
    // 1. Register a test pair
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // 2. Query metrics to ensure hits and misses start at 0
    let metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 0");

    // 3. Request a quote (should be a cache miss)
    const quoteRes1 = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000", slippage_bps: "100" })
      .expect(200);

    metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 1");

    // 4. Request the identical quote (should be a cache hit)
    const quoteRes2 = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000", slippage_bps: "100" })
      .expect(200);

    expect(quoteRes1.body).toEqual(quoteRes2.body);

    metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 1");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 1");
  });

  it("respects dynamic slippage calculation on cache hits", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Miss
    const res1 = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "10000", slippage_bps: "100" })
      .expect(200);
    expect(res1.body.min_received).toBe("9900");

    // Hit with different slippage
    const res2 = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "10000", slippage_bps: "200" })
      .expect(200);
    expect(res2.body.min_received).toBe("9800");

    const metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 1");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 1");
  });

  it("expires cache entries based on quote_ttl_ms config", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Set TTL to 1500ms
    await request(app)
      .patch("/api/v1/config")
      .send({ quote_ttl_ms: 1500 })
      .expect(200);

    // Initial quote (Miss)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Query again immediately (Hit)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    let metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 1");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 1");

    // Wait for TTL to expire
    await sleep(2000);

    // Query after expiry (Miss)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 1");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 2");
  });

  it("invalidates cache on pair metadata PATCH", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Get quote (Miss)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Patch pair fee_bps
    await request(app)
      .patch("/api/v1/pairs/USD/EUR/fee_bps")
      .send({ feeBps: 200 })
      .expect(200);

    // Get quote (Miss, due to invalidation)
    const quoteRes = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Fee bps change should be reflected
    expect(quoteRes.body.feeBps).toBe(200);

    const metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 2");
  });

  it("invalidates cache on pair reset", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Patch first to set non-default fee
    await request(app)
      .patch("/api/v1/pairs/USD/EUR/fee_bps")
      .send({ feeBps: 200 })
      .expect(200);

    // Miss
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Reset metadata
    await request(app)
      .post("/api/v1/pairs/USD/EUR/reset")
      .expect(200);

    // Miss
    const res = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    expect(res.body.feeBps).toBe(0); // reset back to default

    const metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 2");
  });

  it("invalidates cache when pair is disabled or enabled", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Miss
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Disable pair
    await request(app)
      .patch("/api/v1/pairs/USD/EUR/enabled")
      .send({ enabled: false })
      .expect(200);

    // Should return 200 (miss)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    const metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 2");
  });

  it("invalidates cache when pair is unregistered", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    // Miss
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Delete pair
    await request(app)
      .delete("/api/v1/pairs/USD/EUR")
      .expect(204);

    // Query quote again (should return 404 pair_not_registered)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(404);
  });

  it("avoids cache collisions across different pairs and amounts", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "GBP", destination: "EUR" })
      .expect(201);

    // Quote 1: USD/EUR, amount 1000 (Miss)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    // Quote 2: USD/EUR, amount 2000 (Miss, due to different amount)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "2000" })
      .expect(200);

    // Quote 3: GBP/EUR, amount 1000 (Miss, due to different pair)
    await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "GBP", dest_asset: "EUR", amount: "1000" })
      .expect(200);

    const metricsRes = await request(app).get("/api/v1/metrics").expect(200);
    expect(metricsRes.text).toContain("stableroute_quote_cache_hits_total 0");
    expect(metricsRes.text).toContain("stableroute_quote_cache_misses_total 3");
  });

  it("returns 400 when slippage_bps query parameter is invalid", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" })
      .expect(201);

    const res = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USD", dest_asset: "EUR", amount: "1000", slippage_bps: "invalid" })
      .expect(400);

    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toContain("slippage_bps");
  });
});
