import request from "supertest";
import app from "../index";
import { resetStores, pairMeta, defaultMeta, updatePairMetaCas } from "../stores";
import { InMemoryAdapter, JsonFileAdapter } from "../store/adapter";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Comprehensive test suite for Issue #549:
 * Optimistic Concurrency Control (OCC) for Route Updates
 *
 * Edge cases covered:
 * 1. Two updates from same base version -> second gets 409 version_conflict with fresh currentVersion.
 * 2. Sequential updates each bumping version -> both succeed (v1 -> v2 -> v3).
 * 3. Update with missing / blank / null / negative / non-integer version -> 400 invalid_request.
 * 4. Update with future version -> 409 version_conflict with fresh currentVersion.
 * 5. Read always exposes current version (via GET /info and GET /:source/:destination).
 * 6. Concurrency / race condition: Promise.all with N competing updates -> exactly 1 succeeds, others 409.
 * 7. OCC across all mutable fields (fee_bps, min, max, liquidity, rate, enabled, reset).
 * 8. If-Match HTTP header conditional request handling.
 * 9. Store-layer updatePairMetaCas atomic compare-and-set unit tests.
 * 10. Storage adapter metaCas unit tests.
 */

describe("Issue #549: Optimistic Concurrency Control for Route Updates", () => {
  const SRC = "USDC";
  const DST = "EURC";
  const KEY = `${SRC}::${DST}`;

  beforeEach(async () => {
    resetStores();
    await request(app).post("/api/v1/pairs").send({ source: SRC, destination: DST });
  });

  // ── Edge Case 1: Two updates from same base version ───────────────────────

  describe("Edge Case 1: Two updates from same base version", () => {
    it("first update succeeds (v1 -> v2) and second update receives 409 version_conflict", async () => {
      // Both callers start with version 1
      const update1 = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 25, version: 1 });

      expect(update1.status).toBe(200);
      expect(update1.body.feeBps).toBe(25);
      expect(update1.body.version).toBe(2);
      expect(update1.headers.etag).toBe('"2"');

      // Second caller still sends version 1
      const update2 = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 50, version: 1 });

      expect(update2.status).toBe(409);
      expect(update2.body.error).toBe("version_conflict");
      expect(update2.body.message).toMatch(/version conflict/);
      expect(update2.body.currentVersion).toBe(2);
      expect(update2.body.expectedVersion).toBe(1);

      // Verify the route retained the first update
      const info = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(info.body.feeBps).toBe(25);
      expect(info.body.version).toBe(2);
    });
  });

  // ── Edge Case 2: Sequential updates bumping version ───────────────────────

  describe("Edge Case 2: Sequential updates each bumping version", () => {
    it("applies sequential updates cleanly: v1 -> v2 -> v3 -> v4", async () => {
      // v1 -> v2 (fee_bps)
      const res1 = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 15, version: 1 });
      expect(res1.status).toBe(200);
      expect(res1.body.version).toBe(2);
      expect(res1.body.feeBps).toBe(15);

      // v2 -> v3 (liquidity)
      const res2 = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "50000", version: 2 });
      expect(res2.status).toBe(200);
      expect(res2.body.version).toBe(3);
      expect(res2.body.liquidity).toBe("50000");

      // v3 -> v4 (rate)
      const res3 = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/rate`)
        .send({ rate: "1.05", version: 3 });
      expect(res3.status).toBe(200);
      expect(res3.body.version).toBe(4);
      expect(res3.body.rate).toBe("1.05");

      // Read confirms v4
      const info = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(info.status).toBe(200);
      expect(info.body.version).toBe(4);
      expect(info.body.feeBps).toBe(15);
      expect(info.body.liquidity).toBe("50000");
      expect(info.body.rate).toBe("1.05");
      expect(info.headers.etag).toBe('"4"');
    });
  });

  // ── Edge Case 3: Missing / blank / invalid version ─────────────────────────

  describe("Edge Case 3: Update with missing or invalid version returns 400", () => {
    it("rejects update when version is missing from body", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 20 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version is required/);
    });

    it("rejects update when version is null", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "1000", version: null });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version is required/);
    });

    it("rejects update when version is empty string", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/rate`)
        .send({ rate: "1.1", version: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version is required/);
    });

    it("rejects update when version is negative", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 20, version: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version must be a non-negative integer/);
    });

    it("rejects update when version is non-integer decimal", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 20, version: 1.5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version must be a non-negative integer/);
    });

    it("rejects update when version is non-numeric string", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 20, version: "one" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_request");
      expect(res.body.message).toMatch(/version must be a non-negative integer/);
    });

    it("supports expected_version alias in body", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 30, expected_version: 1 });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
      expect(res.body.feeBps).toBe(30);
    });
  });

  // ── Edge Case 4: Future version ───────────────────────────────────────────

  describe("Edge Case 4: Update with future version", () => {
    it("returns 409 version_conflict with fresh currentVersion when future version provided", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "9999", version: 99 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("version_conflict");
      expect(res.body.message).toMatch(/version conflict/);
      expect(res.body.currentVersion).toBe(1);
      expect(res.body.expectedVersion).toBe(99);

      // Verify no changes were committed
      const info = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(info.body.version).toBe(1);
      expect(info.body.liquidity).toBe(defaultMeta().liquidity);
    });
  });

  // ── Edge Case 5: Read always exposes current version ──────────────────────

  describe("Edge Case 5: Read always exposes current version", () => {
    it("GET /info returns current version and matching ETag header", async () => {
      const res = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect(res.headers.etag).toBe('"1"');
    });

    it("GET /:source/:destination returns current version and matching ETag header", async () => {
      const res = await request(app).get(`/api/v1/pairs/${SRC}/${DST}`);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect(res.headers.etag).toBe('"1"');
    });

    it("read reflects immediate version bump after mutation", async () => {
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "50", version: 1 });

      const info = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(info.status).toBe(200);
      expect(info.body.version).toBe(2);
      expect(info.body.minAmount).toBe("50");
      expect(info.headers.etag).toBe('"2"');

      const single = await request(app).get(`/api/v1/pairs/${SRC}/${DST}`);
      expect(single.status).toBe(200);
      expect(single.body.version).toBe(2);
      expect(single.headers.etag).toBe('"2"');
    });
  });

  // ── Field Coverage ────────────────────────────────────────────────────────

  describe("OCC coverage across all route update endpoints", () => {
    it("enforces OCC on PATCH /liquidity", async () => {
      const ok = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "20000", version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);

      const conflict = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/liquidity`)
        .send({ liquidity: "30000", version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
    });

    it("enforces OCC on PATCH /max", async () => {
      const ok = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/max`)
        .send({ maxAmount: "5000", version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);

      const conflict = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/max`)
        .send({ maxAmount: "6000", version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
    });

    it("enforces OCC on PATCH /min", async () => {
      const ok = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "10", version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);

      const conflict = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/min`)
        .send({ minAmount: "20", version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
    });

    it("enforces OCC on PATCH /rate", async () => {
      const ok = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/rate`)
        .send({ rate: "0.95", version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(2);

      const conflict = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/rate`)
        .send({ rate: "0.96", version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
    });

    it("enforces OCC on PATCH /enabled", async () => {
      const ok = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/enabled`)
        .send({ enabled: false, version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.enabled).toBe(false);
      expect(ok.body.version).toBe(2);

      const conflict = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/enabled`)
        .send({ enabled: true, version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
    });

    it("enforces OCC on POST /reset with version", async () => {
      // First mutate pair to v2
      await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .send({ feeBps: 50, version: 1 });

      // Stale reset attempt with v1 fails with 409
      const conflict = await request(app)
        .post(`/api/v1/pairs/${SRC}/${DST}/reset`)
        .send({ version: 1 });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("version_conflict");
      expect(conflict.body.currentVersion).toBe(2);

      // Matching reset with v2 succeeds and advances to v3
      const ok = await request(app)
        .post(`/api/v1/pairs/${SRC}/${DST}/reset`)
        .send({ version: 2 });
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(3);
      expect(ok.body.feeBps).toBe(defaultMeta().feeBps);
      expect(ok.headers.etag).toBe('"3"');
    });
  });

  // ── Concurrency & Race Conditions ─────────────────────────────────────────

  describe("Concurrent Updates / Race Conditions", () => {
    it("handles concurrent competing updates: exactly one succeeds, others get 409", async () => {
      // Launch 5 simultaneous updates with expected version 1
      const promises = [
        request(app).patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`).send({ feeBps: 10, version: 1 }),
        request(app).patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`).send({ feeBps: 20, version: 1 }),
        request(app).patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`).send({ feeBps: 30, version: 1 }),
        request(app).patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`).send({ feeBps: 40, version: 1 }),
        request(app).patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`).send({ feeBps: 50, version: 1 }),
      ];

      const results = await Promise.all(promises);

      const successful = results.filter((r) => r.status === 200);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(4);

      for (const conflict of conflicts) {
        expect(conflict.body.error).toBe("version_conflict");
        expect(conflict.body.currentVersion).toBe(2);
      }

      // Route version is 2
      const info = await request(app).get(`/api/v1/pairs/${SRC}/${DST}/info`);
      expect(info.body.version).toBe(2);
    });
  });

  // ── If-Match HTTP Header Conditional Requests ─────────────────────────────

  describe("If-Match header support", () => {
    it("accepts version via If-Match header", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .set("If-Match", '"1"')
        .send({ feeBps: 42 });

      expect(res.status).toBe(200);
      expect(res.body.feeBps).toBe(42);
      expect(res.body.version).toBe(2);
    });

    it("accepts weak ETag in If-Match header", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .set("If-Match", 'W/"1"')
        .send({ feeBps: 88 });

      expect(res.status).toBe(200);
      expect(res.body.feeBps).toBe(88);
      expect(res.body.version).toBe(2);
    });

    it("rejects mismatched If-Match header with 409 version_conflict", async () => {
      const res = await request(app)
        .patch(`/api/v1/pairs/${SRC}/${DST}/fee_bps`)
        .set("If-Match", '"99"')
        .send({ feeBps: 42 });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("version_conflict");
      expect(res.body.currentVersion).toBe(1);
    });
  });

  // ── Store-Layer Atomic CAS Unit Tests ──────────────────────────────────────

  describe("Store Layer: updatePairMetaCas", () => {
    it("succeeds and increments version on matching version", () => {
      const key = "TEST::KEY";
      pairMeta.set(key, { ...defaultMeta(), version: 5 });

      const result = updatePairMetaCas(key, 5, { feeBps: 123 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.meta.version).toBe(6);
        expect(result.meta.feeBps).toBe(123);
      }
      expect(pairMeta.get(key)?.version).toBe(6);
    });

    it("returns version_conflict on version mismatch without mutating store", () => {
      const key = "TEST::KEY";
      pairMeta.set(key, { ...defaultMeta(), feeBps: 10, version: 5 });

      const result = updatePairMetaCas(key, 3, { feeBps: 123 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("version_conflict");
        expect(result.currentVersion).toBe(5);
        expect(result.expectedVersion).toBe(3);
      }
      expect(pairMeta.get(key)?.version).toBe(5);
      expect(pairMeta.get(key)?.feeBps).toBe(10);
    });

    it("supports functional updater with validation failure", () => {
      const key = "TEST::KEY";
      pairMeta.set(key, { ...defaultMeta(), version: 1 });

      const result = updatePairMetaCas(key, 1, (current) => {
        if (current.feeBps > 50) return null;
        return { error: "custom validation error" };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid_request");
        expect(result.message).toBe("custom validation error");
      }
      expect(pairMeta.get(key)?.version).toBe(1);
    });
  });

  // ── Storage Adapter Layer: metaCas ─────────────────────────────────────────

  describe("Storage Adapter: metaCas", () => {
    it("InMemoryAdapter: metaCas performs atomic compare-and-set", () => {
      const adapter = new InMemoryAdapter();
      adapter.metaSet(KEY, { ...defaultMeta(), version: 1 });
      const meta = adapter.metaGet(KEY);
      expect(meta?.version).toBe(1);

      // Mismatch
      const fail = adapter.metaCas(KEY, 99, { feeBps: 50 });
      expect(fail.ok).toBe(false);
      if (!fail.ok) {
        expect(fail.error).toBe("version_conflict");
        expect(fail.currentVersion).toBe(1);
      }

      // Match
      const success = adapter.metaCas(KEY, 1, { feeBps: 50 });
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.meta.version).toBe(2);
        expect(success.meta.feeBps).toBe(50);
      }
      expect(adapter.metaGet(KEY)?.version).toBe(2);
    });

    it("JsonFileAdapter: metaCas persists version bump across re-open", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-cas-test-"));
      const filePath = path.join(tmpDir, "store.json");

      try {
        const adapter = new JsonFileAdapter(filePath);
        adapter.metaSet(KEY, { ...defaultMeta(), version: 1 });

        const success = adapter.metaCas(KEY, 1, { feeBps: 77 });
        expect(success.ok).toBe(true);
        if (success.ok) {
          expect(success.meta.version).toBe(2);
          expect(success.meta.feeBps).toBe(77);
        }

        // Load into new adapter instance (simulates process restart)
        const adapter2 = new JsonFileAdapter(filePath);
        expect(adapter2.metaGet(KEY)?.version).toBe(2);
        expect(adapter2.metaGet(KEY)?.feeBps).toBe(77);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
