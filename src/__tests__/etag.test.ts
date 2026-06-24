import request from "supertest";
import app from "../index";

// Unique, short (<=12 char) uppercase asset codes so this suite does not
// collide with pairs registered by other test files.
const SRC = "ETAGSRC";
const DST = "ETAGDST";

describe("ETag / conditional GET on /api/v1/pairs", () => {
  afterAll(async () => {
    // Clean up the pair this suite registers so the shared registry is
    // left as we found it.
    await request(app).delete(`/api/v1/pairs/${SRC}/${DST}`);
  });

  it("first GET returns 200 with a weak ETag header", async () => {
    const res = await request(app).get("/api/v1/pairs");
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^W\//);
    expect(Array.isArray(res.body.pairs)).toBe(true);
  });

  it("re-GET with matching If-None-Match returns 304 with empty body", async () => {
    const first = await request(app).get("/api/v1/pairs");
    expect(first.status).toBe(200);
    const etag = first.headers.etag;

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("mutating the set changes the ETag so a stale If-None-Match yields 200", async () => {
    const before = await request(app).get("/api/v1/pairs");
    const staleEtag = before.headers.etag;

    // Mutate the registry with a fresh, unique pair.
    const reg = await request(app)
      .post("/api/v1/pairs")
      .send({ source: SRC, destination: DST });
    expect([200, 201]).toContain(reg.status);

    const after = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", staleEtag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).toBeDefined();
    expect(after.headers.etag).not.toBe(staleEtag);

    // The fresh 200 body parses as JSON with a `pairs` array containing
    // the pair we just registered.
    const body = JSON.parse(after.text);
    expect(Array.isArray(body.pairs)).toBe(true);
    expect(
      body.pairs.some(
        (p: { source: string; destination: string }) =>
          p.source === SRC && p.destination === DST
      )
    ).toBe(true);
  });
});
