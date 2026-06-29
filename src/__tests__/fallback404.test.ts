import request from "supertest";
import app from "../index";

describe("404 fallback and X-Request-Id echo", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("404 body uses canonical error shape", async () => {
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.any(String), message: expect.any(String) });
  });

  it("echoes a valid X-Request-Id back in response header", async () => {
    const id = "test-id-abc123";
    const res = await request(app).get("/missing").set("X-Request-Id", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });

  it("generates a UUID when no X-Request-Id is sent", async () => {
    const res = await request(app).get("/missing");
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("rejects malformed X-Request-Id (over 200 chars) and generates a fresh UUID", async () => {
    // HTTP headers cannot carry CR/LF bytes at the transport layer, so we test
    // the length-limit branch instead. A 201-character ID exceeds the allowed
    // 200-character maximum and must be replaced with a generated UUID.
    const tooLong = "a".repeat(201);
    const res = await request(app).get("/missing").set("X-Request-Id", tooLong);
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("echoes X-Request-Id in 404 response body", async () => {
    const id = "correlation-xyz";
    const res = await request(app).get("/missing").set("X-Request-Id", id);
    expect(res.body.requestId).toBe(id);
  });
});
