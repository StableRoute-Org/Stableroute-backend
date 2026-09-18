/**
 * Unit tests for `InMemoryIdempotencyStore`.
 *
 * Verifies atomic lock acquisition, in-progress detection, fingerprint conflicts,
 * TTL expiry, lock release, LRU bounds, and cross-tenant isolation.
 */

import { InMemoryIdempotencyStore } from "../idempotency/store";

describe("InMemoryIdempotencyStore Unit Tests", () => {
  let store: InMemoryIdempotencyStore;

  beforeEach(() => {
    store = new InMemoryIdempotencyStore(
      () => 1000, // 1s TTL for tests
      () => 5, // max 5 entries for test bounds
    );
  });

  afterEach(async () => {
    await store.clear();
  });

  it("atomically acquires a new key and marks it in_progress", async () => {
    const res = await store.acquire("key-1", "tenant-1", "fp-1", 1000);
    expect(res.status).toBe("acquired");

    const record = await store.get("key-1", "tenant-1");
    expect(record).toBeDefined();
    expect(record?.status).toBe("in_progress");
    expect(record?.fingerprint).toBe("fp-1");
  });

  it("returns in_progress when lock is already held", async () => {
    const res1 = await store.acquire("key-2", "tenant-1", "fp-2", 1000);
    expect(res1.status).toBe("acquired");

    const res2 = await store.acquire("key-2", "tenant-1", "fp-2", 1000);
    expect(res2.status).toBe("in_progress");
  });

  it("returns conflict when same key is used with a different fingerprint", async () => {
    await store.acquire("key-3", "tenant-1", "fp-original", 1000);
    await store.complete("key-3", "tenant-1", 201, { id: "swap-1" });

    const res = await store.acquire("key-3", "tenant-1", "fp-different", 1000);
    expect(res.status).toBe("conflict");
  });

  it("returns completed with cached status and responseBody on replay", async () => {
    await store.acquire("key-4", "tenant-1", "fp-4", 1000);
    await store.complete("key-4", "tenant-1", 201, { id: "swap-4", amount: "100" });

    const replay = await store.acquire("key-4", "tenant-1", "fp-4", 1000);
    expect(replay.status).toBe("completed");
    if (replay.status === "completed") {
      expect(replay.statusCode).toBe(201);
      expect(replay.responseBody).toEqual({ id: "swap-4", amount: "100" });
    }
  });

  it("releases in_progress lock so subsequent requests can re-acquire", async () => {
    await store.acquire("key-5", "tenant-1", "fp-5", 1000);
    await store.release("key-5", "tenant-1");

    // After release, should be able to acquire again
    const res = await store.acquire("key-5", "tenant-1", "fp-5", 1000);
    expect(res.status).toBe("acquired");
  });

  it("does not release completed entries on release()", async () => {
    await store.acquire("key-6", "tenant-1", "fp-6", 1000);
    await store.complete("key-6", "tenant-1", 201, { ok: true });
    await store.release("key-6", "tenant-1");

    const record = await store.get("key-6", "tenant-1");
    expect(record).toBeDefined();
    expect(record?.status).toBe("completed");
  });

  it("evicts expired entry after TTL and allows re-acquire as fresh", async () => {
    // Acquire with 50ms TTL
    await store.acquire("key-7", "tenant-1", "fp-7", 50);
    await store.complete("key-7", "tenant-1", 201, { id: "old-swap" });

    // Wait 70ms for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 70));

    // Re-acquire should treat as fresh and acquire
    const res = await store.acquire("key-7", "tenant-1", "fp-new", 1000);
    expect(res.status).toBe("acquired");
  });

  it("isolates same key across different tenants", async () => {
    const resA = await store.acquire("shared-key", "tenant-A", "fp-A", 1000);
    const resB = await store.acquire("shared-key", "tenant-B", "fp-B", 1000);

    expect(resA.status).toBe("acquired");
    expect(resB.status).toBe("acquired");

    await store.complete("shared-key", "tenant-A", 201, { tenant: "A" });
    await store.complete("shared-key", "tenant-B", 201, { tenant: "B" });

    const getA = await store.get("shared-key", "tenant-A");
    const getB = await store.get("shared-key", "tenant-B");

    expect(getA?.responseBody).toEqual({ tenant: "A" });
    expect(getB?.responseBody).toEqual({ tenant: "B" });
  });

  it("bounds cache size by evicting oldest entries when at capacity", async () => {
    for (let i = 1; i <= 6; i++) {
      await store.acquire(`key-${i}`, "tenant-1", `fp-${i}`, 10_000);
      await store.complete(`key-${i}`, "tenant-1", 201, { i });
    }

    // Capacity is 5, so key-1 should have been evicted
    expect(store.size()).toBeLessThanOrEqual(5);
    const oldest = await store.get("key-1", "tenant-1");
    expect(oldest).toBeUndefined();

    const newest = await store.get("key-6", "tenant-1");
    expect(newest).toBeDefined();
  });
});
