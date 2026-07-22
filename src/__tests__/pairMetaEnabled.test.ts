import request from "supertest";
import app from "../index";
import { resetStores } from "../stores";

describe("PATCH /api/v1/pairs/:source/:destination/enabled", () => {
  beforeEach(() => {
    resetStores();
  });

  it("toggles enabled flag with a boolean body", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "EURC" });
    const res = await request(app)
      .patch("/api/v1/pairs/USDC/EURC/enabled")
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("rejects non-boolean enabled values", async () => {
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USDC", destination: "EURC" });
    const res = await request(app)
      .patch("/api/v1/pairs/USDC/EURC/enabled")
      .send({ enabled: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 404 for unregistered pairs", async () => {
    const res = await request(app)
      .patch("/api/v1/pairs/AAA/BBB/enabled")
      .send({ enabled: true });
    expect(res.status).toBe(404);
  });
});
