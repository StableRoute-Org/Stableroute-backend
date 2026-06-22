import request from "supertest";
import app from "../index";

describe("GET /api/v1/pairs ETag handling", () => {
  it("returns 200 with a weak ETag on the first request", async () => {
    const res = await request(app).get("/api/v1/pairs");

    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/=]+"$/);
    expect(res.body).toHaveProperty("pairs");
  });

  it("returns 304 with an empty body when If-None-Match matches", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const etag = first.headers.etag;

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("returns 200 when If-None-Match does not match", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", 'W/"definitely-stale"');

    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/"/);
    expect(res.body).toHaveProperty("pairs");
  });

  it("changes ETag after registering a new pair", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const staleEtag = first.headers.etag;

    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "ETAG0001", destination: "ETAG0002" });

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", staleEtag);

    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(staleEtag);
    expect(second.body.pairs).toEqual(
      expect.arrayContaining([
        { source: "ETAG0001", destination: "ETAG0002" },
      ])
    );
  });
});
