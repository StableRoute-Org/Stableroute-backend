/**
 * In-memory sliding window counter store with sub-window estimation.
 *
 * Implements the counter approximation algorithm:
 *   estimatedRequests = floor(previousWindowCount * (1 - elapsedInCurrent / windowMs) + currentWindowCount)
 *
 * This provides O(1) time and O(1) space complexity per tenant, smoothly dampens bursts
 * across window boundaries (preventing 2x traffic bursts), and bounds memory via LRU eviction.
 *
 * @module rateLimit/slidingWindowStore
 */

import type {
  RateLimitBucket,
  RateLimitResult,
  RateLimitStore,
} from "./types";

export interface SlidingWindowStoreOptions {
  maxKeys?: number | undefined;
}

export class InMemorySlidingWindowStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly maxKeys: number;

  constructor(options: SlidingWindowStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  private advanceWindow(
    bucket: RateLimitBucket,
    currentWindowStart: number,
    windowMs: number,
  ): void {
    if (bucket.currentWindowStart === currentWindowStart) {
      return;
    }

    const diff = currentWindowStart - bucket.currentWindowStart;
    if (diff === windowMs) {
      // Advanced by exactly one window: current moves to previous
      bucket.previousCount = bucket.currentCount;
      bucket.currentCount = 0;
      bucket.currentWindowStart = currentWindowStart;
    } else if (diff > windowMs) {
      // Advanced by more than one window: both sub-windows are cold
      bucket.previousCount = 0;
      bucket.currentCount = 0;
      bucket.currentWindowStart = currentWindowStart;
    }
  }

  private getOrCreateBucket(key: string, currentWindowStart: number): RateLimitBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      // LRU eviction if capacity reached
      if (this.buckets.size >= this.maxKeys) {
        const oldestKey = this.buckets.keys().next().value as string;
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey);
        }
      }
      bucket = {
        currentWindowStart,
        currentCount: 0,
        previousCount: 0,
        lastUpdated: Date.now(),
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  consume(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): RateLimitResult {
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const bucket = this.getOrCreateBucket(key, currentWindowStart);
    this.advanceWindow(bucket, currentWindowStart, windowMs);

    const elapsed = Math.max(0, now - currentWindowStart);
    const weight = Math.max(0, 1 - elapsed / windowMs);
    const estimatedCount = Math.floor(bucket.previousCount * weight + bucket.currentCount);

    const resetTime = Math.ceil((currentWindowStart + windowMs) / 1000);
    const msUntilReset = Math.max(0, currentWindowStart + windowMs - now);
    const retryAfter = Math.max(1, Math.ceil(msUntilReset / 1000));

    if (estimatedCount >= limit) {
      bucket.lastUpdated = now;
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime,
        retryAfter,
        currentUsage: estimatedCount,
      };
    }

    bucket.currentCount += 1;
    bucket.lastUpdated = now;

    const newEstimated = Math.floor(bucket.previousCount * weight + bucket.currentCount);
    const remaining = Math.max(0, limit - newEstimated);

    return {
      allowed: true,
      limit,
      remaining,
      resetTime,
      retryAfter: 0,
      currentUsage: newEstimated,
    };
  }

  getUsage(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): RateLimitResult {
    const currentWindowStart = Math.floor(now / windowMs) * windowMs;
    const bucket = this.buckets.get(key);

    const resetTime = Math.ceil((currentWindowStart + windowMs) / 1000);
    const msUntilReset = Math.max(0, currentWindowStart + windowMs - now);
    const retryAfter = Math.max(1, Math.ceil(msUntilReset / 1000));

    if (!bucket) {
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetTime,
        retryAfter: 0,
        currentUsage: 0,
      };
    }

    // Clone to compute without mutating
    const b: RateLimitBucket = { ...bucket };
    this.advanceWindow(b, currentWindowStart, windowMs);

    const elapsed = Math.max(0, now - currentWindowStart);
    const weight = Math.max(0, 1 - elapsed / windowMs);
    const estimatedCount = Math.floor(b.previousCount * weight + b.currentCount);
    const remaining = Math.max(0, limit - estimatedCount);

    return {
      allowed: estimatedCount < limit,
      limit,
      remaining,
      resetTime,
      retryAfter: estimatedCount >= limit ? retryAfter : 0,
      currentUsage: estimatedCount,
    };
  }

  /**
   * Prune buckets that have been inactive for more than 2 full windows.
   */
  prune(now: number, windowMs: number): number {
    let pruned = 0;
    const cutoff = now - windowMs * 2;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastUpdated < cutoff) {
        this.buckets.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }

  size(): number {
    return this.buckets.size;
  }
}
