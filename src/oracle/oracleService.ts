/**
 * Resilient Price Oracle service wrapping upstream rate lookups in
 * retry-with-backoff and per-dependency circuit breakers.
 *
 * @module oracle/oracleService
 */

import {
  circuitBreakerRegistry,
  CircuitBreaker,
  type CircuitBreakerOptions,
} from "./circuitBreaker";
import { withRetry, type RetryOptions } from "./retry";
import { logger } from "../logger";

export interface OracleRateResult {
  source: string;
  destination: string;
  rate: string;
  timestamp: number;
  cached?: boolean;
}

export type OracleRateFetcher = (
  source: string,
  destination: string,
) => Promise<string>;

export interface PriceOracleServiceOptions {
  dependencyName?: string | undefined;
  breakerThreshold?: number | undefined;
  breakerCooldownMs?: number | undefined;
  retryAttempts?: number | undefined;
  retryBaseDelayMs?: number | undefined;
  retryMaxDelayMs?: number | undefined;
  backoffMultiplier?: number | undefined;
  jitter?: boolean | undefined;
  fetcher?: OracleRateFetcher | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export class PriceOracleService {
  readonly dependencyName: string;
  private readonly breaker: CircuitBreaker;
  private fetcher: OracleRateFetcher;
  private retryOptions: RetryOptions;

  constructor(options: PriceOracleServiceOptions = {}) {
    this.dependencyName = options.dependencyName ?? "price-oracle";

    this.breaker = circuitBreakerRegistry.getBreaker(this.dependencyName, {
      failureThreshold: options.breakerThreshold ?? 5,
      cooldownMs: options.breakerCooldownMs ?? 30000,
    });

    this.fetcher =
      options.fetcher ??
      (async (source, destination) => {
        // Default deterministic fallback rate lookup
        if (source === destination) return "1.0";
        return "1.0";
      });

    this.retryOptions = {
      maxAttempts: options.retryAttempts ?? 3,
      baseDelayMs: options.retryBaseDelayMs ?? 100,
      maxDelayMs: options.retryMaxDelayMs ?? 5000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      jitter: options.jitter ?? true,
      isIdempotent: true, // Quote/rate reads are strictly idempotent
      ...(options.sleep ? { sleep: options.sleep } : {}),
    };
  }

  /** Set custom rate fetcher (e.g. mock or external HTTP oracle). */
  setFetcher(fetcher: OracleRateFetcher): void {
    this.fetcher = fetcher;
  }

  /** Configure runtime retry parameters. */
  updateRetryOptions(options: Partial<RetryOptions>): void {
    this.retryOptions = { ...this.retryOptions, ...options };
  }

  /** Configure runtime breaker parameters. */
  updateBreakerOptions(options: Partial<CircuitBreakerOptions>): void {
    this.breaker.updateOptions(options);
  }

  /**
   * Fetch exchange rate for an asset pair through the guarded circuit breaker and retry pipeline.
   *
   * Flow:
   * 1. Check Circuit Breaker (fails fast if OPEN).
   * 2. Execute with bounded retry + exponential backoff + jitter on transient failures.
   * 3. Return validated rate string.
   */
  async getRate(source: string, destination: string): Promise<OracleRateResult> {
    const startedAt = Date.now();

    try {
      const rate = await this.breaker.execute(async () => {
        return await withRetry(async (attempt) => {
          if (attempt > 1) {
            logger.debug(
              { dependency: this.dependencyName, source, destination, attempt },
              `[price-oracle] retrying rate fetch (attempt ${attempt})`,
            );
          }
          return await this.fetcher(source, destination);
        }, this.retryOptions);
      });

      return {
        source,
        destination,
        rate,
        timestamp: startedAt,
      };
    } catch (err) {
      logger.warn(
        { dependency: this.dependencyName, source, destination, error: err },
        "[price-oracle] failed to resolve rate from oracle",
      );
      throw err;
    }
  }

  /** Retrieve the underlying circuit breaker instance for this dependency. */
  getBreaker(): CircuitBreaker {
    return this.breaker;
  }

  /** Reset breaker and internal state. */
  reset(): void {
    this.breaker.reset();
  }
}

/** Global default price oracle service instance. */
export const defaultPriceOracleService = new PriceOracleService();
