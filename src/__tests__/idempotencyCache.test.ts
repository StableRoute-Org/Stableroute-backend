import request from "supertest";
import app, { clearIdempotencyCache } from "../index";
import { resetStores } from "../stores";

describe("Idempotency-Key — cache edge cases", () => {
  beforeEach(() => {
    resetStores();
    clearIdempotencyCache();
    delete process.env.IDEMPOTENCY_TTL_MS;
    delete process.env.IDEMPOTENCY_CACHE_MAX;
  });

  afterEach(() => {
    delete process.env.IDEMPOTENCY_TTL_MS;
    delete process.env.IDEMPOTENCY_CACHE_MAX;
  });

  describe("Key length boundaries", () => {
    it("passes through when key is an empty string (0-length)", async () => {
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", "")
        .send({ label: "k1" });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", "")
        .send({ label: "k1" });
      expect(res2.status).toBe(201);
      expect(res2.body.key).not.toBe(res1.body.key);
    });

    it("caches a key at exactly 1 character", async () => {
      const key = "a";
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "one-char" });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "one-char" });
      expect(res2.status).toBe(201);
      expect(res2.body).toEqual(res1.body);
    });

    it("caches a key at exactly 200 characters", async () => {
      const key = "x".repeat(200);
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "200-char" });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "200-char" });
      expect(res2.status).toBe(201);
      expect(res2.body).toEqual(res1.body);
    });

    it("passes through when key is 201 characters", async () => {
      const key = "x".repeat(201);
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "too-long" });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "too-long" });
      expect(res2.status).toBe(201);
      expect(res2.body.key).not.toBe(res1.body.key);
    });

    it("passes through when key is whitespace only (no caching)", async () => {
      const key = "   ";
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "spaces" });
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "spaces" });
      expect(res2.status).toBe(201);
      expect(res2.body.key).not.toBe(res1.body.key);
    });
  });

  describe("Non-participating endpoints", () => {
    it("POST /api/v1/pairs/bulk ignores Idempotency-Key (same key, different body → no 409)", async () => {
      const key = "bulk-idem";
      const res1 = await request(app)
        .post("/api/v1/pairs/bulk")
        .set("Idempotency-Key", key)
        .send({ pairs: [{ source: "BULKA", destination: "BULKB" }] });
      expect(res1.status).toBe(200);
      expect(res1.body.results[0].ok).toBe(true);

      const res2 = await request(app)
        .post("/api/v1/pairs/bulk")
        .set("Idempotency-Key", key)
        .send({ pairs: [{ source: "BULKC", destination: "BULKD" }] });
      expect(res2.status).toBe(200);
      expect(res2.body.results[0].ok).toBe(true);
    });

    it("PATCH /api/v1/pairs/:source/:destination/enabled ignores Idempotency-Key", async () => {
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: "ENABL", destination: "TEST" });

      const key = "patch-idem";
      const res1 = await request(app)
        .patch("/api/v1/pairs/ENABL/TEST/enabled")
        .set("Idempotency-Key", key)
        .send({ enabled: true });
      expect(res1.status).toBe(200);
      expect(res1.body.enabled).toBe(true);

      const res2 = await request(app)
        .patch("/api/v1/pairs/ENABL/TEST/enabled")
        .set("Idempotency-Key", key)
        .send({ enabled: false });
      expect(res2.status).toBe(200);
      expect(res2.body.enabled).toBe(false);
    });
  });

  describe("Cache lifecycle", () => {
    it("clearIdempotencyCache() discards all entries — handler executes again", async () => {
      const key = "clear-test";
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "before-clear" });
      expect(res1.status).toBe(201);

      clearIdempotencyCache();

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "before-clear" });
      expect(res2.status).toBe(201);
      expect(res2.body.key).not.toBe(res1.body.key);
    });

    it("expired entry is removed and handler executes again", async () => {
      process.env.IDEMPOTENCY_TTL_MS = "20";
      const key = "expire-test";
      const res1 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "expire-me" });
      expect(res1.status).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 30));

      const res2 = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "expire-me" });
      expect(res2.status).toBe(201);
      expect(res2.body.key).not.toBe(res1.body.key);
    });
  });

  describe("Body hash sensitivity", () => {
    it("different JSON key ordering yields 409 conflict", async () => {
      const key = "json-order";
      const body1 = { source: "ORDRA", destination: "TSTRA" };
      const body2 = { destination: "TSTRA", source: "ORDRA" };

      const res1 = await request(app)
        .post("/api/v1/pairs")
        .set("Idempotency-Key", key)
        .send(body1);
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/pairs")
        .set("Idempotency-Key", key)
        .send(body2);
      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("idempotency_conflict");
    });
  });

  describe("Cross-endpoint isolation", () => {
    it("same key on different endpoints does not cross-contaminate", async () => {
      const key = "shared-key";

      const keyRes = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "shared" });
      expect(keyRes.status).toBe(201);

      const whRes = await request(app)
        .post("/api/v1/webhooks")
        .set("Idempotency-Key", key)
        .send({ url: "https://example.com/share", events: ["pair.registered"] });
      expect(whRes.status).toBe(201);

      const keyReplay = await request(app)
        .post("/api/v1/api-keys")
        .set("Idempotency-Key", key)
        .send({ label: "shared" });
      expect(keyReplay.status).toBe(201);
      expect(keyReplay.body).toEqual(keyRes.body);
    });
  });
});
