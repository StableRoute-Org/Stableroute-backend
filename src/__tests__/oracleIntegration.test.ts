import request from "supertest";
import app from "../index";
import { resetStores } from "../stores";
import { defaultPriceOracleService } from "../oracle";

describe("Oracle & Circuit Breaker Endpoints Integration", () => {
  beforeEach(() => {
    resetStores();
    // Default fetcher for testing
    defaultPriceOracleService.setFetcher(async (src, dst) => {
      if (src === "USD" && dst === "EUR") return "0.92";
      if (src === "USDC" && dst === "XLM") return "8.50";
      return "1.00";
    });
    defaultPriceOracleService.updateRetryOptions({
      maxAttempts: 3,
      baseDelayMs: 5,
      sleep: async () => {}, // Instant sleep for tests
    });
  });

  describe("GET /api/v1/oracle/status", () => {
    it("returns list of all registered circuit breakers with metrics", async () => {
      const res = await request(app).get("/api/v1/oracle/status");
      expect(res.status).toBe(200);
      expect(res.body.breakers).toBeDefined();
      expect(Array.isArray(res.body.breakers)).toBe(true);

      const priceOracle = res.body.breakers.find(
        (b: { name: string }) => b.name === "price-oracle",
      );
      expect(priceOracle).toBeDefined();
      expect(priceOracle.state).toBe("CLOSED");
      expect(priceOracle.consecutiveFailures).toBe(0);
    });

    it("returns single breaker when dependency query parameter is passed", async () => {
      const res = await request(app)
        .get("/api/v1/oracle/status")
        .query({ dependency: "price-oracle" });

      expect(res.status).toBe(200);
      expect(res.body.breaker).toBeDefined();
      expect(res.body.breaker.name).toBe("price-oracle");
      expect(res.body.breaker.state).toBe("CLOSED");
    });
  });

  describe("GET /api/v1/oracle/rate/:source/:destination", () => {
    it("validates asset inputs and rejects identical assets", async () => {
      const resIdentical = await request(app).get("/api/v1/oracle/rate/USD/USD");
      expect(resIdentical.status).toBe(400);
      expect(resIdentical.body.code).toBe("invalid_request");

      const resInvalid = await request(app).get("/api/v1/oracle/rate/TOOLONGSYMBOL12345/EUR");
      expect(resInvalid.status).toBe(400);
      expect(resInvalid.body.code).toBe("invalid_request");
    });

    it("successfully returns oracle exchange rate for valid assets", async () => {
      const res = await request(app).get("/api/v1/oracle/rate/USD/EUR");
      expect(res.status).toBe(200);
      expect(res.body.source).toBe("USD");
      expect(res.body.destination).toBe("EUR");
      expect(res.body.rate).toBe("0.92");
      expect(typeof res.body.timestamp).toBe("number");
    });

    it("trips circuit breaker on repeated failures and returns 503 upstream_unavailable", async () => {
      // Configure mock fetcher that continuously fails
      defaultPriceOracleService.setFetcher(async () => {
        const err = new Error("Gateway 502 Bad Gateway");
        (err as unknown as { status: number }).status = 502;
        throw err;
      });

      // Default threshold is 5. Each request retries 3 times, but counts as 1 breaker failure
      // So after 5 distinct failed getRate requests, the breaker trips to OPEN.
      for (let i = 0; i < 5; i++) {
        const resFail = await request(app).get("/api/v1/oracle/rate/USDC/XLM");
        expect(resFail.status).toBe(500);
      }

      // Check breaker status is now OPEN
      const breaker = defaultPriceOracleService.getBreaker();
      expect(breaker.getState()).toBe("OPEN");

      // Next request fails fast with 503 upstream_unavailable (circuit breaker OPEN)
      const resOpen = await request(app).get("/api/v1/oracle/rate/USDC/XLM");
      expect(resOpen.status).toBe(503);
      expect(resOpen.body.code).toBe("upstream_unavailable");
      expect(resOpen.body.message).toContain("circuit breaker");
    });
  });

  describe("GET /api/v1/metrics Prometheus exposition", () => {
    it("exposes circuit breaker gauges and counters in prometheus format", async () => {
      // Ensure price-oracle has 1 success
      await request(app).get("/api/v1/oracle/rate/USD/EUR");

      const res = await request(app).get("/api/v1/metrics");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");

      const text = res.text;
      expect(text).toContain("# HELP stableroute_circuit_breaker_state");
      expect(text).toContain("# TYPE stableroute_circuit_breaker_state gauge");
      expect(text).toContain('stableroute_circuit_breaker_state{dependency="price-oracle"} 0');

      expect(text).toContain("# HELP stableroute_circuit_breaker_successes_total");
      expect(text).toContain('stableroute_circuit_breaker_successes_total{dependency="price-oracle"} 1');

      expect(text).toContain("# HELP stableroute_circuit_breaker_failures_total");
      expect(text).toContain('stableroute_circuit_breaker_failures_total{dependency="price-oracle"} 0');
    });
  });

  describe("PATCH /api/v1/config dynamic tuning", () => {
    it("allows updating oracle retry and breaker configuration dynamically", async () => {
      const res = await request(app)
        .patch("/api/v1/config")
        .send({
          oracleRetryAttempts: 4,
          oracleBackoffBaseMs: 250,
          oracleBreakerThreshold: 10,
          oracleBreakerCooldownMs: 60000,
        });

      expect(res.status).toBe(200);
      expect(res.body.config.oracleRetryAttempts).toBe(4);
      expect(res.body.config.oracleBackoffBaseMs).toBe(250);
      expect(res.body.config.oracleBreakerThreshold).toBe(10);
      expect(res.body.config.oracleBreakerCooldownMs).toBe(60000);
    });
  });
});
