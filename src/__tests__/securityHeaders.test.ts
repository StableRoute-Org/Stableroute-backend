import request from "supertest";
import app from "../index";

const expectedSecurityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const expectSecurityHeaders = (headers: Record<string, string | string[] | undefined>) => {
  for (const [name, value] of Object.entries(expectedSecurityHeaders)) {
    expect(headers[name]).toBe(value);
  }
};

describe("security headers", () => {
  it("sets the baseline headers on a 200 response", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expectSecurityHeaders(res.headers);
  });

  it("sets the baseline headers on a 404 response", async () => {
    const res = await request(app).get("/api/v1/unknown-security-header-route");

    expect(res.status).toBe(404);
    expectSecurityHeaders(res.headers);
  });

  it("sets the baseline headers on a 400 response", async () => {
    const res = await request(app).get("/api/v1/quote");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expectSecurityHeaders(res.headers);
  });
});
