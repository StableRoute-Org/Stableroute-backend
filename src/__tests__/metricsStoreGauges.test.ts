import request from "supertest";
import app from "../index";
import { resetStores, config } from "../stores";

beforeEach(() => resetStores());
afterEach(() => resetStores());

describe("GET /api/v1/metrics — store and config gauges", () => {
  it("emits HELP/TYPE lines and zero values for empty stores", async () => {
    const res = await request(app).get("/api/v1/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain.*version=0\.0\.4/);

    for (const name of [
      "stableroute_api_keys_total",
      "stableroute_webhooks_total",
      "stableroute_event_log_size",
      "stableroute_rate_limit_per_window",
    ]) {
      expect(res.text).toContain(`# TYPE ${name} gauge`);
    }
    expect(res.text).toMatch(/^stableroute_api_keys_total 0$/m);
    expect(res.text).toMatch(/^stableroute_webhooks_total 0$/m);
    expect(res.text).toMatch(/^stableroute_event_log_size 0$/m);
  });

  it("reflects populated stores and the configured rate limit", async () => {
    await request(app).post("/api/v1/api-keys").send({ label: "ci" });
    await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: ["pair.registered"] });
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "EURC" });
    config.rateLimitPerWindow = 123;

    const res = await request(app).get("/api/v1/metrics");
    expect(res.text).toMatch(/^stableroute_api_keys_total 1$/m);
    expect(res.text).toMatch(/^stableroute_webhooks_total 1$/m);
    // One pair registration -> at least one event in the log.
    expect(res.text).toMatch(/^stableroute_event_log_size [1-9][0-9]*$/m);
    expect(res.text).toMatch(/^stableroute_rate_limit_per_window 123$/m);
  });

  it("keeps the existing two gauges intact", async () => {
    const res = await request(app).get("/api/v1/metrics");
    expect(res.text).toContain("# TYPE stableroute_pairs_total gauge");
    expect(res.text).toContain("# TYPE stableroute_paused gauge");
  });
});
