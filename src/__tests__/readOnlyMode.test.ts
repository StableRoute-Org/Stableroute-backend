import request from "supertest";
import app from "../index";
import { setPaused, setReadOnly } from "../stores";

beforeAll(() => {
  process.env.ALLOW_UNREGISTERED_QUOTES = "true";
});

afterAll(() => {
  delete process.env.ALLOW_UNREGISTERED_QUOTES;
});

afterEach(() => {
  setReadOnly(false);
  setPaused(false);
});

describe("Read-only maintenance mode", () => {
  it("surfaces readOnly alongside paused in admin status", async () => {
    const res = await request(app).get("/api/v1/admin/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paused: false, readOnly: false });
  });

  it("toggles read-only on and off via admin endpoints", async () => {
    const on = await request(app).post("/api/v1/admin/read-only");
    expect(on.status).toBe(200);
    expect(on.body.readOnly).toBe(true);

    const status = await request(app).get("/api/v1/admin/status");
    expect(status.body.readOnly).toBe(true);

    const off = await request(app).post("/api/v1/admin/read-write");
    expect(off.status).toBe(200);
    expect(off.body.readOnly).toBe(false);
  });

  it("blocks mutating writes with 503 read_only_mode", async () => {
    setReadOnly(true);
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("read_only_mode");
    expect(res.body.requestId).toBeTruthy();
  });

  it("still allows reads (GET) while read-only", async () => {
    setReadOnly(true);
    const res = await request(app).get("/api/v1/pairs");
    expect(res.status).toBe(200);
  });

  it("still allows GET quotes while read-only", async () => {
    setReadOnly(true);
    const res = await request(app)
      .get("/api/v1/quote")
      .query({ source_asset: "USDC", dest_asset: "EURC", amount: "100" });
    expect(res.status).toBe(200);
  });

  it("still allows POST bulk quotes while read-only", async () => {
    setReadOnly(true);
    const res = await request(app)
      .post("/api/v1/quote/bulk")
      .send({ items: [{ source_asset: "USDC", dest_asset: "EURC", amount: "100" }] });
    expect(res.status).toBe(200);
  });

  it("keeps the recovery endpoint reachable while read-only", async () => {
    setReadOnly(true);
    const res = await request(app).post("/api/v1/admin/read-write");
    expect(res.status).toBe(200);
    expect(res.body.readOnly).toBe(false);
  });

  it("paused overrides read-only (pause behavior wins)", async () => {
    setReadOnly(true);
    setPaused(true);
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "USD", destination: "EUR" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("service_paused");
  });
});
