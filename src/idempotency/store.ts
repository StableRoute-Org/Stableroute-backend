/**
 * In-memory reference implementation of `IdempotencyStore`.
 *
 * Implements atomic concurrency locking, TTL-based eviction, oldest-first
 * LRU bounds, and tenant-isolated key lookups.
 *
 * @module idempotency/store
 */

import type {
  IdempotencyRecord,
  IdempotencyStore,
  LockResult,
} from "./types";

export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_IDEMPOTENCY_MAX_SIZE = 10_000;

export const getIdempotencyTtlMs = (): number => {
  const envVal = process.env.IDEMPOTENCY_TTL_MS;
  if (!envVal) return DEFAULT_IDEMPOTENCY_TTL_MS;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_IDEMPOTENCY_TTL_MS;
};

export const getIdempotencyCacheMax = (): number => {
  const envVal = process.env.IDEMPOTENCY_CACHE_MAX;
  if (!envVal) return DEFAULT_IDEMPOTENCY_MAX_SIZE;
  const parsed = parseInt(envVal, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_IDEMPOTENCY_MAX_SIZE;
};

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly getTtl: () => number = getIdempotencyTtlMs,
    private readonly getMax: () => number = getIdempotencyCacheMax,
  ) {}

  private storageKey(key: string, tenantId: string): string {
    return `${tenantId}::${key}`;
  }

  async acquire(
    key: string,
    tenantId: string,
    fingerprint: string,
    ttlMs?: number,
  ): Promise<LockResult> {
    const sKey = this.storageKey(key, tenantId);
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.getTtl();

    const existing = this.store.get(sKey);
    if (existing) {
      if (existing.expiresAt <= now) {
        // Expired entry — prune it and treat as fresh
        this.store.delete(sKey);
      } else {
        // Active entry found — check fingerprint match
        if (existing.fingerprint !== fingerprint) {
          return { status: "conflict" };
        }
        if (existing.status === "in_progress") {
          return { status: "in_progress" };
        }
        if (existing.status === "completed") {
          return {
            status: "completed",
            statusCode: existing.statusCode ?? 200,
            responseBody: existing.responseBody,
          };
        }
      }
    }

    // Atomic insert-if-absent lock
    this.prune();
    const newRecord: IdempotencyRecord = {
      key,
      tenantId,
      fingerprint,
      status: "in_progress",
      createdAt: now,
      expiresAt: now + effectiveTtl,
    };
    this.store.set(sKey, newRecord);

    return { status: "acquired" };
  }

  async complete(
    key: string,
    tenantId: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    const sKey = this.storageKey(key, tenantId);
    const existing = this.store.get(sKey);
    if (!existing) return;

    existing.status = "completed";
    existing.statusCode = statusCode;
    existing.responseBody = responseBody;
    // Re-insert to refresh insertion-order in Map
    this.store.delete(sKey);
    this.store.set(sKey, existing);
  }

  async release(key: string, tenantId: string): Promise<void> {
    const sKey = this.storageKey(key, tenantId);
    const existing = this.store.get(sKey);
    if (existing && existing.status === "in_progress") {
      this.store.delete(sKey);
    }
  }

  async get(
    key: string,
    tenantId: string,
  ): Promise<IdempotencyRecord | undefined> {
    const sKey = this.storageKey(key, tenantId);
    const existing = this.store.get(sKey);
    if (!existing) return undefined;
    if (existing.expiresAt <= Date.now()) {
      this.store.delete(sKey);
      return undefined;
    }
    return existing;
  }

  async delete(key: string, tenantId: string): Promise<void> {
    this.store.delete(this.storageKey(key, tenantId));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(k);
      }
    }
    const maxEntries = this.getMax();
    while (this.store.size >= maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      } else {
        break;
      }
    }
  }
}

/** Global singleton store for swap idempotency. */
export const idempotencyStore = new InMemoryIdempotencyStore();

/** Clear singleton store for clean test isolation. */
export const resetIdempotencyStore = async (): Promise<void> => {
  await idempotencyStore.clear();
};
