import request from "supertest";
import app from "../index";
import { setPaused } from "../stores";

afterEach(() => setPaused(false));

describe("Pause guard", () => {
  it("allows GET requests while paused", async () => {
    setPaused(true);
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("allows HEAD requests while paused", async () => {
    setPaused(true);
    const res = await request(app).head("/health");
    expect(res.status).toBe(200);
  });

  it("blocks POST requests with 503 while paused", async () => {
    setPaused(true);
    const res = await request(app).post("/api/v1/pairs").send({ source: "USD", destination: "EUR" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("service_paused");
  });

  it("blocks DELETE requests with 503 while paused", async () => {
    setPaused(true);
    const res = await request(app).delete("/api/v1/pairs/USD/EUR");
    expect(res.status).toBe(503);
  });

  it("carves out POST /api/v1/admin/unpause even while paused", async () => {
    setPaused(true);
    const res = await request(app).post("/api/v1/admin/unpause");
    expect(res.status).not.toBe(503);
  });

  it("unpauses the service via POST /api/v1/admin/unpause", async () => {
    setPaused(true);
    await request(app).post("/api/v1/admin/unpause");
    const res = await request(app).post("/api/v1/pairs").send({ source: "USD", destination: "EUR" });
    expect(res.status).not.toBe(503);
  });

  it("normal POST works when not paused", async () => {
    setPaused(false);
    const res = await request(app).post("/api/v1/pairs").send({ source: "USD", destination: "EUR" });
    expect(res.status).not.toBe(503);
  });
});
