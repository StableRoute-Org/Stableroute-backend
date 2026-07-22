import request from "supertest";
import app from "../index";
import { resetStores } from "../stores";

beforeEach(() => resetStores());
afterEach(() => resetStores());

describe("GET /api/v1/stats breakdown", () => {
  it("returns zeroed aggregates for an empty system", async () => {
    const res = await request(app).get("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalPairs: 0,
      paused: false,
      totalApiKeys: 0,
      totalWebhooks: 0,
      totalEvents: 0,
      pairsWithFee: 0,
      distinctAssets: 0,
    });
  });

  it("derives counts from pairs, keys, webhooks, events and fees", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "EURC" });
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "XLM" });
    // Set a fee on one pair only.
    await request(app)
      .patch("/api/v1/pairs/USDC/EURC/fee_bps")
      .send({ feeBps: 25 });

    await request(app).post("/api/v1/api-keys").send({ label: "ci" });
    await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: ["pair.registered"] });

    const res = await request(app).get("/api/v1/stats");
    expect(res.status).toBe(200);
    expect(res.body.totalPairs).toBe(2);
    expect(res.body.totalApiKeys).toBe(1);
    expect(res.body.totalWebhooks).toBe(1);
    // Two pair registrations -> at least two events recorded.
    expect(res.body.totalEvents).toBeGreaterThanOrEqual(2);
    expect(res.body.pairsWithFee).toBe(1);
    // Distinct assets: USDC, EURC, XLM.
    expect(res.body.distinctAssets).toBe(3);
  });
});
