import request from "supertest";
import app from "../index";

describe("GET /api/v1/pairs ETag handling", () => {
  it("returns a weak ETag and 304 with an empty body for matching If-None-Match", async () => {
    const first = await request(app).get("/api/v1/pairs");

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ pairs: expect.any(Array) });
    expect(first.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]{1,16}"$/);

    const cached = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", first.headers.etag);

    expect(cached.status).toBe(304);
    expect(cached.text).toBe("");
  });

  it("returns 200 for a stale ETag after the pair list changes", async () => {
    const before = await request(app).get("/api/v1/pairs");
    const staleEtag = before.headers.etag;

    expect(before.status).toBe(200);
    expect(staleEtag).toMatch(/^W\/".+"$/);

    const suffix = Date.now().toString(36).slice(-6).toUpperCase();
    const source = `S${suffix}`.slice(0, 12);
    const destination = `D${suffix}`.slice(0, 12);

    const created = await request(app)
      .post("/api/v1/pairs")
      .send({ source, destination });

    expect(created.status).toBe(201);

    const after = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", staleEtag);

    expect(after.status).toBe(200);
    expect(after.headers.etag).toMatch(/^W\/".+"$/);
    expect(after.headers.etag).not.toBe(staleEtag);
    expect(after.body.pairs).toContainEqual({ source, destination });
  });

  it("returns 200 when If-None-Match does not match the current ETag", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", 'W/"definitely-stale"');

    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/".+"$/);
    expect(res.body).toEqual({ pairs: expect.any(Array) });
  });
});
