import request from "supertest";
import app from "../index";

describe("GET /api/v1/pairs ETag handling", () => {
  it("returns a weak ETag and uses it for 304 Not Modified responses", async () => {
    const first = await request(app).get("/api/v1/pairs");

    expect(first.status).toBe(200);
    expect(first.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);

    const cached = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", first.headers.etag);

    expect(cached.status).toBe(304);
    expect(cached.text).toBe("");
  });

  it("changes the ETag after registering a new pair", async () => {
    const before = await request(app).get("/api/v1/pairs");
    const staleEtag = before.headers.etag;

    expect(before.status).toBe(200);
    expect(staleEtag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);

    const register = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "ETAG20A", destination: "ETAG20B" });

    expect(register.status).toBe(201);

    const after = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", staleEtag);

    expect(after.status).toBe(200);
    expect(after.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);
    expect(after.headers.etag).not.toBe(staleEtag);
    expect(after.body.pairs).toContainEqual({
      source: "ETAG20A",
      destination: "ETAG20B",
    });
  });

  it("returns 200 when If-None-Match does not match the current ETag", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", 'W/"not-current"');

    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);
    expect(res.body).toHaveProperty("pairs");
  });
});
