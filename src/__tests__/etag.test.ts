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

describe("HEAD /api/v1/pairs — ETag without body", () => {
  const HSRC = "HEADETAG";
  const HDST = "HEADETGD";

  afterAll(async () => {
    await request(app).delete(`/api/v1/pairs/${HSRC}/${HDST}`);
  });

  it("HEAD returns 200 with a weak ETag header and no body", async () => {
    const res = await request(app).head("/api/v1/pairs");
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^W\//);
    // HEAD responses carry no body — supertest returns undefined for res.text
    expect(res.body).toEqual({});
  });

  it("HEAD returns the same ETag as GET for the same registry state", async () => {
    const getRes = await request(app).get("/api/v1/pairs");
    const headRes = await request(app).head("/api/v1/pairs");
    expect(headRes.status).toBe(200);
    expect(headRes.headers.etag).toBe(getRes.headers.etag);
  });

  it("HEAD returns Content-Type application/json", async () => {
    const res = await request(app).head("/api/v1/pairs");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("HEAD returns a numeric Content-Length matching the GET body size", async () => {
    const getRes = await request(app).get("/api/v1/pairs");
    const headRes = await request(app).head("/api/v1/pairs");
    const expectedLength = Buffer.byteLength(getRes.text).toString();
    expect(headRes.headers["content-length"]).toBe(expectedLength);
    // HEAD responses carry no body — supertest returns undefined for res.text
    expect(headRes.body).toEqual({});
  });

  it("HEAD with matching If-None-Match returns 304 with empty body", async () => {
    const getRes = await request(app).get("/api/v1/pairs");
    const etag = getRes.headers.etag;

    const res = await request(app)
      .head("/api/v1/pairs")
      .set("If-None-Match", etag);
    expect(res.status).toBe(304);
    // HEAD responses carry no body — supertest returns undefined for res.text
    expect(res.body).toEqual({});
  });

  it("HEAD with non-matching If-None-Match returns 200 with empty body", async () => {
    const res = await request(app)
      .head("/api/v1/pairs")
      .set("If-None-Match", 'W/"stalevalue000"');
    expect(res.status).toBe(200);
    // HEAD responses carry no body — supertest returns undefined for res.text
    expect(res.body).toEqual({});
  });

  it("HEAD ETag is stable across repeated calls with the same registry state", async () => {
    const first = await request(app).head("/api/v1/pairs");
    const second = await request(app).head("/api/v1/pairs");
    expect(first.headers.etag).toBe(second.headers.etag);
  });

  it("HEAD ETag changes after a pair is registered", async () => {
    const before = await request(app).head("/api/v1/pairs");
    const staleEtag = before.headers.etag;

    const reg = await request(app)
      .post("/api/v1/pairs")
      .send({ source: HSRC, destination: HDST });
    expect([200, 201]).toContain(reg.status);

    const after = await request(app).head("/api/v1/pairs");
    expect(after.status).toBe(200);
    expect(after.headers.etag).toBeDefined();
    expect(after.headers.etag).not.toBe(staleEtag);
  });

  it("HEAD on empty registry returns 200 with a valid ETag", async () => {
    // Use the current state (may or may not be empty) — just assert shape.
    const res = await request(app).head("/api/v1/pairs");
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/]{1,}={0,2}"$/);
    // HEAD responses carry no body — supertest returns undefined for res.text
    expect(res.body).toEqual({});
  });
});
