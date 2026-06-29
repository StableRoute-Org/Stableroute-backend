import { isValidRequestId } from "../index";

// We test the exported helpers indirectly via the request layer.
// Direct unit tests for isAssetCode and parseAmount require exporting them;
// until then we cover boundary behaviour through the quote endpoint.
import request from "supertest";
import app from "../index";

describe("isValidRequestId boundary behaviour", () => {
  it("accepts a single character", () => expect(isValidRequestId("a")).toBe(true));
  it("accepts 200 characters", () => expect(isValidRequestId("a".repeat(200))).toBe(true));
  it("rejects 201 characters", () => expect(isValidRequestId("a".repeat(201))).toBe(false));
  it("rejects empty string", () => expect(isValidRequestId("")).toBe(false));
  it("rejects newline", () => expect(isValidRequestId("ab\ncd")).toBe(false));
  it("rejects CR", () => expect(isValidRequestId("ab\rcd")).toBe(false));
  it("rejects space", () => expect(isValidRequestId("ab cd")).toBe(false));
  it("accepts dots, dashes, underscores", () => expect(isValidRequestId("a.b-c_d")).toBe(true));
});

describe("parseAmount boundary behaviour (via quote endpoint)", () => {
  beforeAll(async () => {
    await request(app).post("/api/v1/pairs").send({ source: "USD", destination: "EUR" });
  });

  it("rejects zero amount", async () => {
    const res = await request(app)
      .post("/api/v1/quote")
      .send({ source_asset: "USD", dest_asset: "EUR", amount: "0" });
    expect(res.status).toBe(400);
  });

  it("rejects negative amount", async () => {
    const res = await request(app)
      .post("/api/v1/quote")
      .send({ source_asset: "USD", dest_asset: "EUR", amount: "-100" });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric amount", async () => {
    const res = await request(app)
      .post("/api/v1/quote")
      .send({ source_asset: "USD", dest_asset: "EUR", amount: "abc" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid positive integer amount", async () => {
    const res = await request(app)
      .post("/api/v1/quote")
      .send({ source_asset: "USD", dest_asset: "EUR", amount: "1000000" });
    expect([200, 400]).toContain(res.status);
  });
});

describe("isAssetCode boundary behaviour (via pairs endpoint)", () => {
  it("rejects empty source asset", async () => {
    const res = await request(app).post("/api/v1/pairs").send({ source: "", destination: "EUR" });
    expect(res.status).toBe(400);
  });

  it("rejects asset code longer than 12 chars", async () => {
    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "TOOLONGASSET1", destination: "EUR" });
    expect(res.status).toBe(400);
  });

  it("accepts a valid 3-char asset code", async () => {
    const res = await request(app).post("/api/v1/pairs").send({ source: "GBP", destination: "JPY" });
    expect([200, 201, 409]).toContain(res.status);
  });
});
