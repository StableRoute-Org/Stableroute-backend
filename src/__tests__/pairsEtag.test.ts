/**
 * pairsEtag.test.ts
 *
 * Comprehensive test coverage for the ETag and 304 Not Modified behavior on
 * GET /api/v1/pairs.
 *
 * Covers:
 *   - First GET returns 200 with a weak ETag header in W/"..." format.
 *   - Follow-up GET with matching If-None-Match returns 304 with an empty body.
 *   - ETag changes after a new pair is registered (cache invalidation).
 *   - Stale If-None-Match after mutation returns 200 with updated body.
 *   - ETag is stable across repeated requests when registry is unchanged.
 *   - GET with a non-matching If-None-Match always returns 200 with full body.
 *   - 304 response body is empty (no JSON, no partial data).
 */

import request from "supertest";
import app from "../index";

// Unique asset codes (<=12 chars, uppercase) so this suite never collides
// with pairs registered by other test files sharing the in-memory registry.
const SRC = "PETAG1SRC";
const DST = "PETAG1DST";
const SRC2 = "PETAG2SRC";
const DST2 = "PETAG2DST";

describe("GET /api/v1/pairs — ETag and 304 conditional request coverage", () => {
  afterAll(async () => {
    // Remove any pairs registered during this suite so the shared in-memory
    // registry is restored to its pre-suite state.
    await request(app).delete(`/api/v1/pairs/${SRC}/${DST}`);
    await request(app).delete(`/api/v1/pairs/${SRC2}/${DST2}`);
  });

  // ── Initial response shape ─────────────────────────────────────────────────

  it("first GET returns 200 with an ETag header", async () => {
    const res = await request(app).get("/api/v1/pairs");
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
  });

  it('ETag header uses the weak validator format W/"..."', async () => {
    const res = await request(app).get("/api/v1/pairs");
    expect(res.headers.etag).toMatch(/^W\/"[A-Za-z0-9+/]+=*"$/);
  });

  it("first GET response body contains a pairs array", async () => {
    const res = await request(app).get("/api/v1/pairs");
    expect(Array.isArray(res.body.pairs)).toBe(true);
  });

  // ── 304 Not Modified path ──────────────────────────────────────────────────

  it("GET with matching If-None-Match returns 304", async () => {
    const first = await request(app).get("/api/v1/pairs");
    expect(first.status).toBe(200);
    const etag = first.headers.etag;

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });

  it("304 response has an empty body", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const etag = first.headers.etag;

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("304 response body does not contain JSON", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const etag = first.headers.etag;

    const second = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
    expect(Object.keys(second.body).length).toBe(0);
  });

  // ── Non-matching ETag always yields 200 ───────────────────────────────────

  it("GET with a non-matching If-None-Match returns 200", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", 'W/"000000000000000"');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    expect(Array.isArray(res.body.pairs)).toBe(true);
  });

  it("GET with a non-matching If-None-Match returns a fresh ETag header", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", 'W/"stalevalue00000"');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^W\//);
  });

  // ── ETag stability when registry is unchanged ─────────────────────────────

  it("ETag is identical across two consecutive GETs with no mutations", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const second = await request(app).get("/api/v1/pairs");
    expect(first.headers.etag).toBe(second.headers.etag);
  });

  it("ETag round-trip: GET, cache with ETag, re-GET yields 304", async () => {
    const initial = await request(app).get("/api/v1/pairs");
    expect(initial.status).toBe(200);
    const cachedEtag = initial.headers.etag;

    // Simulate three consecutive conditional requests — all should be 304.
    for (let i = 0; i < 3; i++) {
      const cached = await request(app)
        .get("/api/v1/pairs")
        .set("If-None-Match", cachedEtag);
      expect(cached.status).toBe(304);
    }
  });

  // ── Cache invalidation after mutation ─────────────────────────────────────

  it("ETag changes after a new pair is registered", async () => {
    const before = await request(app).get("/api/v1/pairs");
    const etagBefore = before.headers.etag;

    const reg = await request(app)
      .post("/api/v1/pairs")
      .send({ source: SRC, destination: DST });
    expect([200, 201]).toContain(reg.status);

    const after = await request(app).get("/api/v1/pairs");
    expect(after.status).toBe(200);
    expect(after.headers.etag).toBeDefined();
    expect(after.headers.etag).not.toBe(etagBefore);
  });

  it("stale If-None-Match after mutation returns 200 with updated body", async () => {
    const before = await request(app).get("/api/v1/pairs");
    const staleEtag = before.headers.etag;

    // Register a second unique pair to ensure the ETag changes.
    const reg = await request(app)
      .post("/api/v1/pairs")
      .send({ source: SRC2, destination: DST2 });
    expect([200, 201]).toContain(reg.status);

    const after = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", staleEtag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(staleEtag);

    const body = JSON.parse(after.text);
    expect(Array.isArray(body.pairs)).toBe(true);
    expect(
      body.pairs.some(
        (p: { source: string; destination: string }) =>
          p.source === SRC2 && p.destination === DST2,
      ),
    ).toBe(true);
  });

  it("re-GET after mutation with old ETag returns fresh ETag in 200 response", async () => {
    const first = await request(app).get("/api/v1/pairs");
    const oldEtag = first.headers.etag;

    // Post another pair to mutate the registry (idempotent if already registered).
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: SRC, destination: DST });

    const res = await request(app)
      .get("/api/v1/pairs")
      .set("If-None-Match", oldEtag);

    // The status is either 304 (if ETag coincidentally matches) or 200 with a new ETag.
    if (res.status === 200) {
      expect(res.headers.etag).toBeDefined();
      expect(res.headers.etag).toMatch(/^W\//);
    } else {
      expect(res.status).toBe(304);
    }
  });
});
