import request from "supertest";
import app from "../index";

describe("GET /api/v1/pairs ETag handling", () => {
  it("returns 200 with a weak ETag header on the pairs listing", async () => {
    const res = await request(app).get("/api/v1/pairs");

    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]{1,16}"$/);
    expect(Array.isArray(res.body.pairs)).toBe(true);
  });

  it("returns 304 with an empty body when If-None-Match matches", async () => {
    const first = await request(app).get("/api/v1/pairs");

    const cached = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", first.headers.etag);

    expect(cached.status).toBe(304);
    expect(cached.text).toBe("");
  });

  it("changes the ETag after a new pair is registered", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const oldEtag = first.headers.etag;

    const registered = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "ETAG20A", destination: "ETAG20B" });
    expect([200, 201]).toContain(registered.status);

    const stale = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", oldEtag);

    expect(stale.status).toBe(200);
    expect(stale.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]{1,16}"$/);
    expect(stale.headers.etag).not.toBe(oldEtag);
    expect(stale.body.pairs).toContainEqual({
      source: "ETAG20A",
      destination: "ETAG20B",
    });
  });
});
