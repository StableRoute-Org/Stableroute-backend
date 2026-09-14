import { describe, it, expect, beforeEach } from "vitest";
import { IdempotencyStore, resetIdempotencyStore } from "../utils/idempotency";

describe("IdempotencyStore", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    store = new IdempotencyStore(60000, 100);
  });

  it("stores and retrieves records", () => {
    const record = {
      key: "test-key",
      method: "POST",
      path: "/swap",
      bodyHash: "abc123",
      status: 200,
      body: { result: "ok" },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    store.set(record);
    expect(store.get("test-key")).toEqual(record);
  });

  it("returns undefined for missing keys", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("expires old records", async () => {
    const shortStore = new IdempotencyStore(1, 100);
    shortStore.set({
      key: "expire-test",
      method: "POST",
      path: "/swap",
      bodyHash: "hash",
      status: 200,
      body: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 1,
    });
    await new Promise(r => setTimeout(r, 10));
    expect(shortStore.get("expire-test")).toBeUndefined();
  });

  it("evicts oldest when at capacity", () => {
    const smallStore = new IdempotencyStore(60000, 2);
    smallStore.set({ key: "k1", method: "POST", path: "/p", bodyHash: "h", status: 200, body: null, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
    smallStore.set({ key: "k2", method: "POST", path: "/p", bodyHash: "h", status: 200, body: null, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
    smallStore.set({ key: "k3", method: "POST", path: "/p", bodyHash: "h", status: 200, body: null, createdAt: Date.now(), expiresAt: Date.now() + 60000 });
    expect(smallStore.get("k1")).toBeUndefined();
  });
});
