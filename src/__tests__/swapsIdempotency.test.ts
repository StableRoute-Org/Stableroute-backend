/**
 * Integration test suite for `POST /api/v1/swaps` idempotency-key support
 * and concurrency-safe replay semantics (Issue #548).
 *
 * Verifies all edge cases and acceptance criteria:
 * - [x] same key + same body twice -> one swap, identical responses
 * - [x] same key + different body -> 409 conflict (idempotency_conflict)
 * - [x] two concurrent requests, same key -> exactly one executes (409 request_in_progress)
 * - [x] key reuse after TTL expiry -> treated as new
 * - [x] header absent -> behavior unchanged
 * - [x] malformed / oversized key -> 400
 * - [x] same key across two tenants -> isolated
 * - [x] domain validation, pause state, and list/get endpoints
 */

import request from "supertest";
import app, {
  clearIdempotencyCache,
  swapStore,
  resetSwapStore,
} from "../index";
import {
  pairRegistry,
  pairMeta,
  pairKey,
  resetStores,
  setPaused,
  setReadOnly,
} from "../stores";
import { resetIdempotencyStore } from "../idempotency/store";
import { isValidIdempotencyKey } from "../idempotency/middleware";

describe("POST /api/v1/swaps — Idempotency-Key & Concurrency-Safe Replay (#548)", () => {
  beforeEach(async () => {
    resetStores();
    clearIdempotencyCache();
    await resetIdempotencyStore();
    resetSwapStore();
    delete process.env.IDEMPOTENCY_TTL_MS;
    delete process.env.IDEMPOTENCY_CACHE_MAX;

    // Register active test pair: USDC -> EURC
    const k = pairKey("USDC", "EURC");
    pairRegistry.add(k);
    pairMeta.set(k, {
      feeBps: 50,
      minAmount: "10",
      maxAmount: "1000000",
      liquidity: "10000000",
      enabled: true,
      rate: "1.0",
    });
  });

  afterEach(async () => {
    resetStores();
    clearIdempotencyCache();
    await resetIdempotencyStore();
    resetSwapStore();
    delete process.env.IDEMPOTENCY_TTL_MS;
    delete process.env.IDEMPOTENCY_CACHE_MAX;
  });

  const validSwapPayload = {
    source_asset: "USDC",
    dest_asset: "EURC",
    amount: "1000",
    slippage_bps: 50,
  };

  describe("Edge Case 1: same key + same body twice -> one swap, identical responses", () => {
    it("returns identical 201 response on replay and creates only one swap in store", async () => {
      const key = "idem-key-replay-1";

      const res1 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send(validSwapPayload);

      expect(res1.status).toBe(201);
      expect(res1.body.id).toBeDefined();
      expect(res1.body.source_asset).toBe("USDC");
      expect(res1.body.dest_asset).toBe("EURC");
      expect(res1.body.amount).toBe("1000");
      expect(res1.body.status).toBe("completed");

      const initialCount = swapStore.size;
      expect(initialCount).toBe(1);

      // Replay with identical key and identical body
      const res2 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send(validSwapPayload);

      expect(res2.status).toBe(201);
      expect(res2.body).toEqual(res1.body);
      // Ensure no duplicate swap was created in the store
      expect(swapStore.size).toBe(1);
    });

    it("replays identical response even when JSON keys are ordered differently", async () => {
      const key = "idem-key-ordering";

      const res1 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send({
          source_asset: "USDC",
          dest_asset: "EURC",
          amount: "500",
        });
      expect(res1.status).toBe(201);

      // Replay with permuted key order in the JSON body
      const res2 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send({
          amount: "500",
          dest_asset: "EURC",
          source_asset: "USDC",
        });

      expect(res2.status).toBe(201);
      expect(res2.body).toEqual(res1.body);
      expect(swapStore.size).toBe(1);
    });
  });

  describe("Edge Case 2: same key + different body -> 409 conflict", () => {
    it("rejects repeat request with differing body as 409 idempotency_conflict", async () => {
      const key = "idem-key-conflict-1";

      const res1 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send(validSwapPayload);
      expect(res1.status).toBe(201);

      // Same key, different amount
      const res2 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send({
          ...validSwapPayload,
          amount: "2000",
        });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe("idempotency_conflict");
      expect(res2.body.error).toBe("idempotency_conflict");
      expect(res2.body.message).toMatch(/different request body/i);

      // Same key, different destination asset
      const res3 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send({
          ...validSwapPayload,
          dest_asset: "XLM",
        });

      expect(res3.status).toBe(409);
      expect(res3.body.code).toBe("idempotency_conflict");

      // Verify still only 1 swap in store
      expect(swapStore.size).toBe(1);
    });
  });

  describe("Edge Case 3: two concurrent requests, same key -> exactly one executes", () => {
    it("permits one winner and rejects the concurrent request with 409 request_in_progress", async () => {
      const key = "idem-key-concurrent";

      // Fire two requests concurrently with the identical key
      const [p1, p2] = await Promise.all([
        request(app)
          .post("/api/v1/swaps")
          .set("Idempotency-Key", key)
          .send(validSwapPayload),
        request(app)
          .post("/api/v1/swaps")
          .set("Idempotency-Key", key)
          .send(validSwapPayload),
      ]);

      const statuses = [p1.status, p2.status].sort();
      // One request should succeed (201 or 201 replay), or one 201 and one 409 request_in_progress
      if (statuses.includes(409)) {
        expect(statuses).toEqual([201, 409]);
        const rejected = p1.status === 409 ? p1 : p2;
        expect(rejected.body.code).toBe("request_in_progress");
        expect(rejected.body.error).toBe("request_in_progress");
      } else {
        // If execution finished fast enough to replay
        expect(statuses).toEqual([201, 201]);
        expect(p1.body).toEqual(p2.body);
      }

      // Exactly one swap record exists
      expect(swapStore.size).toBe(1);
    });
  });

  describe("Edge Case 4: key reuse after TTL expiry -> treated as new", () => {
    it("allows fresh swap execution with same key after TTL expires", async () => {
      // Set short TTL for test
      process.env.IDEMPOTENCY_TTL_MS = "60"; // 60ms
      const key = "idem-key-ttl-expiry";

      const res1 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send(validSwapPayload);

      expect(res1.status).toBe(201);
      const swapId1 = res1.body.id;
      expect(swapStore.size).toBe(1);

      // Wait 90ms for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 90));

      // After expiry, request with same key is treated as fresh
      const res2 = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", key)
        .send(validSwapPayload);

      expect(res2.status).toBe(201);
      const swapId2 = res2.body.id;
      expect(swapId2).not.toBe(swapId1);
      expect(swapStore.size).toBe(2);
    });
  });

  describe("Edge Case 5: header absent -> behavior unchanged", () => {
    it("creates separate swaps on repeated calls without Idempotency-Key", async () => {
      const res1 = await request(app)
        .post("/api/v1/swaps")
        .send(validSwapPayload);
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post("/api/v1/swaps")
        .send(validSwapPayload);
      expect(res2.status).toBe(201);

      expect(res1.body.id).not.toBe(res2.body.id);
      expect(swapStore.size).toBe(2);
    });
  });

  describe("Edge Case 6: malformed / oversized key -> 400", () => {
    it("rejects an empty key with 400 invalid_request", async () => {
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", "")
        .send(validSwapPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(swapStore.size).toBe(0);
    });

    it("rejects a whitespace-only key with 400 invalid_request", async () => {
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", "     ")
        .send(validSwapPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(swapStore.size).toBe(0);
    });

    it("rejects an oversized key (> 200 characters) with 400 invalid_request", async () => {
      const oversizedKey = "k".repeat(201);
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", oversizedKey)
        .send(validSwapPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(res.body.message).toMatch(/Idempotency-Key header must be 1-200/i);
      expect(swapStore.size).toBe(0);
    });

    it("accepts an exact boundary key (200 characters)", async () => {
      const boundaryKey = "k".repeat(200);
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", boundaryKey)
        .send(validSwapPayload);

      expect(res.status).toBe(201);
      expect(swapStore.size).toBe(1);
    });

    it("rejects purely whitespace keys", async () => {
      const badKey = "     ";
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", badKey)
        .send(validSwapPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(swapStore.size).toBe(0);
    });

    it("identifies invalid keys via isValidIdempotencyKey validator", () => {
      expect(isValidIdempotencyKey("")).toBe(false);
      expect(isValidIdempotencyKey("   ")).toBe(false);
      expect(isValidIdempotencyKey("k".repeat(201))).toBe(false);
      expect(isValidIdempotencyKey("key\nwith\rnewline")).toBe(false);
      expect(isValidIdempotencyKey("key\twith\ttab")).toBe(false);
      expect(isValidIdempotencyKey("valid-key-123_ABC")).toBe(true);
      expect(isValidIdempotencyKey("k".repeat(200))).toBe(true);
    });
  });

  describe("Edge Case 7: same key across two tenants -> isolated", () => {
    it("allows separate executions with the same key across distinct tenants", async () => {
      const sharedKey = "shared-tenant-idem-key";

      // Tenant A executes
      const resA = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", sharedKey)
        .set("X-Tenant-Id", "tenant-alpha")
        .send(validSwapPayload);

      expect(resA.status).toBe(201);
      const swapIdA = resA.body.id;

      // Tenant B executes with identical key and same payload
      const resB = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", sharedKey)
        .set("X-Tenant-Id", "tenant-beta")
        .send(validSwapPayload);

      expect(resB.status).toBe(201);
      const swapIdB = resB.body.id;

      // The two swaps must be distinct
      expect(swapIdA).not.toBe(swapIdB);
      expect(swapStore.size).toBe(2);

      // Tenant A replays and receives swap A
      const replayA = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", sharedKey)
        .set("X-Tenant-Id", "tenant-alpha")
        .send(validSwapPayload);

      expect(replayA.status).toBe(201);
      expect(replayA.body.id).toBe(swapIdA);

      // Tenant B replays and receives swap B
      const replayB = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", sharedKey)
        .set("X-Tenant-Id", "tenant-beta")
        .send(validSwapPayload);

      expect(replayB.status).toBe(201);
      expect(replayB.body.id).toBe(swapIdB);
    });
  });

  describe("Domain Validation & Swap Endpoint Behavior", () => {
    it("rejects unknown body fields", async () => {
      const res = await request(app)
        .post("/api/v1/swaps")
        .send({
          ...validSwapPayload,
          malicious_field: "hack",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    });

    it("rejects swaps when service is paused", async () => {
      setPaused(true);
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", "pause-test")
        .send(validSwapPayload);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("service_paused");
    });

    it("rejects swaps when service is in read-only mode", async () => {
      setReadOnly(true);
      const res = await request(app)
        .post("/api/v1/swaps")
        .set("Idempotency-Key", "ro-test")
        .send(validSwapPayload);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("read_only_mode");
    });

    it("rejects unregistered currency pairs", async () => {
      const res = await request(app)
        .post("/api/v1/swaps")
        .send({
          source_asset: "UNKNOWN",
          dest_asset: "EURC",
          amount: "100",
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("pair_not_registered");
    });

    it("rejects non-positive amount", async () => {
      const res = await request(app)
        .post("/api/v1/swaps")
        .send({
          source_asset: "USDC",
          dest_asset: "EURC",
          amount: "-50",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    });

    it("debits bounded liquidity on swap execution", async () => {
      const k = pairKey("USDC", "EURC");
      const beforeLiq = BigInt(pairMeta.get(k)!.liquidity);

      const res = await request(app)
        .post("/api/v1/swaps")
        .send(validSwapPayload);

      expect(res.status).toBe(201);
      const afterLiq = BigInt(pairMeta.get(k)!.liquidity);
      expect(afterLiq).toBe(beforeLiq - 1000n);
    });

    it("lists swaps via GET /api/v1/swaps and fetches single swap via GET /api/v1/swaps/:id", async () => {
      const res1 = await request(app)
        .post("/api/v1/swaps")
        .send(validSwapPayload);
      expect(res1.status).toBe(201);
      const swapId = res1.body.id;

      // GET list
      const listRes = await request(app).get("/api/v1/swaps");
      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body.swaps)).toBe(true);
      expect(listRes.body.swaps.length).toBeGreaterThanOrEqual(1);

      // GET by id
      const getRes = await request(app).get(`/api/v1/swaps/${swapId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(swapId);

      // GET unknown id
      const notFoundRes = await request(app).get("/api/v1/swaps/non-existent-id");
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.code).toBe("not_found");
    });
  });
});
