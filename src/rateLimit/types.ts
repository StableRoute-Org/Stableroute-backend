/**
/**
 * Types and interfaces for the Sliding Window Rate Limiter.
 *
 * @module rateLimit/types
 */

export interface RateLimitOptions {
  /** Window duration in milliseconds. Defaults to 60,000 ms (1 minute). */
  windowMs?: number | undefined;
  /** Maximum requests allowed within the sliding window. Defaults to 60. */
  limit?: number | undefined;
  /** Maximum number of distinct keys tracked in-memory to prevent unbounded memory growth. Defaults to 10,000. */
  maxKeys?: number | undefined;
}

export interface RateLimitResult {
  /** Whether the request is within limits and allowed to proceed. */
  allowed: boolean;
  /** Configured limit for this sliding window. */
  limit: number;
  /** Remaining request allowance in current sliding window. Clamped to >= 0. */
  remaining: number;
  /** Unix timestamp in seconds when current window concludes. */
  resetTime: number;
  /** Seconds to wait before retrying when rate limited. 0 if allowed. */
  retryAfter: number;
  /** Current calculated sliding request count. */
  currentUsage: number;
}

export interface RateLimitBucket {
  /** Start timestamp (ms) of the current sub-window. */
  currentWindowStart: number;
  /** Number of requests recorded in the current sub-window. */
  currentCount: number;
  /** Number of requests recorded in the prior sub-window. */
  previousCount: number;
  /** Last updated timestamp (ms) for LRU tracking. */
  lastUpdated: number;
}

/**
 * Storage interface for rate limit counters.
 * Allows pluggable backends (in-memory, Redis, distributed cache).
 */
export interface RateLimitStore {
  /**
   * Consume 1 unit of quota for the given key and return current limit status.
   *
   * @param key - Unique tenant, API key, or client identifier.
   * @param now - Current epoch timestamp in milliseconds.
   * @param windowMs - Window duration in milliseconds.
   * @param limit - Maximum requests allowed per window.
   */
  consume(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitResult> | RateLimitResult;

  /**
   * Check current usage without incrementing the counter.
   */
  getUsage(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): Promise<RateLimitResult> | RateLimitResult;

  /** Reset counters for a specific key. */
  reset(key: string): void;

  /** Reset all stored rate limit state. */
  resetAll(): void;

  /** Current number of active keys in the store. */
  size(): number;
}
