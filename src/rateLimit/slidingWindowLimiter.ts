/**
 * Sliding Window Rate Limiter engine.
 *
 * Coordinates consumption against a pluggable {@link RateLimitStore}.
 *
 * @module rateLimit/slidingWindowLimiter
 */

import { InMemorySlidingWindowStore } from "./slidingWindowStore";
import type {
  RateLimitOptions,
  RateLimitResult,
  RateLimitStore,
} from "./types";

export class SlidingWindowRateLimiter {
  private readonly store: RateLimitStore;
  private windowMs: number;
  private limit: number;

  constructor(options: RateLimitOptions = {}, store?: RateLimitStore) {
    this.windowMs = options.windowMs ?? 60_000;
    this.limit = options.limit ?? 60;
    this.store = store ?? new InMemorySlidingWindowStore({ maxKeys: options.maxKeys });
  }

  /**
   * Process a request for the given key and record usage.
   *
   * @param key - Tenant or API key identifier.
   * @param now - Optional epoch timestamp in milliseconds (defaults to Date.now()).
   */
  async consume(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    return await this.store.consume(key, now, this.windowMs, this.limit);
  }

  /**
   * Inspect current rate limit state for a key without consuming quota.
   *
   * @param key - Tenant or API key identifier.
   * @param now - Optional epoch timestamp in milliseconds (defaults to Date.now()).
   */
  async getUsage(key: string, now: number = Date.now()): Promise<RateLimitResult> {
    return await this.store.getUsage(key, now, this.windowMs, this.limit);
  }

  /** Update window and limit parameters dynamically at runtime. */
  updateOptions(options: Partial<RateLimitOptions>): void {
    if (options.windowMs !== undefined && options.windowMs > 0) {
      this.windowMs = options.windowMs;
    }
    if (options.limit !== undefined && options.limit > 0) {
      this.limit = options.limit;
    }
  }

  /** Reset a single key or all keys. */
  reset(key?: string): void {
    if (key) {
      this.store.reset(key);
    } else {
      this.store.resetAll();
    }
  }

  /** Get current options. */
  getOptions(): { windowMs: number; limit: number } {
    return { windowMs: this.windowMs, limit: this.limit };
  }

  /** Get the underlying store. */
  getStore(): RateLimitStore {
    return this.store;
  }
}
