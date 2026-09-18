/**
 * Exponential backoff with jitter and error classification for resilient upstream calls.
 *
 * Requirements fulfilled:
 * - Bounded retry attempts (strictly adheres to maxAttempts).
 * - Exponential backoff: `delay = min(baseDelayMs * (multiplier ^ attempt), maxDelayMs)`.
 * - Full jitter: randomizes wait interval within [0, delay] to prevent thundering herd spikes.
 * - Idempotency protection: non-idempotent operations are never blindly retried.
 * - Error classification: only transient failures (network blips, 5xx, 429) are retried;
 *   permanent client errors (4xx, schema rejections) fail immediately.
 *
 * @module oracle/retry
 */

import { logger } from "../logger";

export interface RetryOptions {
  /** Total maximum attempts, including initial try. Defaults to 3 (initial try + 2 retries). */
  maxAttempts?: number | undefined;
  /** Base backoff delay in milliseconds. Defaults to 100 ms. */
  baseDelayMs?: number | undefined;
  /** Maximum backoff ceiling in milliseconds. Defaults to 5,000 ms. */
  maxDelayMs?: number | undefined;
  /** Backoff multiplier per attempt. Defaults to 2. */
  backoffMultiplier?: number | undefined;
  /** Whether to apply full jitter randomization. Defaults to true. */
  jitter?: boolean | undefined;
  /**
   * Whether the operation is idempotent. If false, the operation is NEVER retried
   * on failure, even if the error is transient, preventing duplicated side effects.
   * Defaults to true (safe for reads/quotes).
   */
  isIdempotent?: boolean | undefined;
  /**
   * Custom predicate to determine whether an error is transient and retryable.
   * If omitted, {@link isTransientError} is used by default.
   */
  isRetryable?: ((error: unknown) => boolean) | undefined;
  /** Optional hook invoked before sleeping on retry. */
  onRetry?: ((error: unknown, attempt: number, delayMs: number) => void) | undefined;
  /** Sleep implementation; injectable for deterministic unit testing. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

/**
 * Standard default sleep helper.
 */
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Classify whether an error represents a transient, retryable failure.
 *
 * Retryable:
 * - Network failures: ECONNRESET, ETIMEDOUT, ECONNREFUSED, ENOTFOUND, EAI_AGAIN.
 * - HTTP 5xx responses (500, 502, 503, 504).
 * - HTTP 429 (rate limited / too many requests).
 *
 * Non-retryable:
 * - HTTP 4xx responses (400, 401, 403, 404, 409, 415, 422).
 * - Syntax/type errors, validation failures, assertion errors.
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  // Handle standard node Error properties or Axios/Fetch response errors
  const err = error as Record<string, unknown>;

  // Check code property
  const code = typeof err.code === "string" ? err.code : "";
  const retryableCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ]);
  if (retryableCodes.has(code)) return true;

  // Check status / statusCode
  const status = Number(err.status ?? err.statusCode ?? err.responseStatus);
  if (Number.isInteger(status)) {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status >= 400 && status < 500) return false;
  }

  // Check message patterns for timeout or network errors
  const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("service unavailable") ||
    msg.includes("bad gateway") ||
    msg.includes("gateway timeout")
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate backoff delay with exponential scaling and optional full jitter.
 *
 * Formula:
 *   maxInterval = min(baseDelayMs * (multiplier ^ (attempt - 1)), maxDelayMs)
 *   delay = jitter ? Math.random() * maxInterval : maxInterval
 *
 * @param attempt     - 1-based attempt index (first retry is attempt 1).
 * @param baseDelayMs - Base delay in ms.
 * @param maxDelayMs  - Upper bound cap in ms.
 * @param multiplier  - Multiplier factor.
 * @param jitter      - Whether to randomize within [0, maxInterval].
 * @returns Backoff delay in milliseconds.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = 100,
  maxDelayMs = 5000,
  multiplier = 2,
  jitter = true,
): number {
  const exponent = Math.max(0, attempt - 1);
  const rawDelay = baseDelayMs * Math.pow(multiplier, exponent);
  const cappedDelay = Math.min(rawDelay, maxDelayMs);

  if (!jitter) {
    return cappedDelay;
  }

  // Full jitter: uniformly random between 0 and cappedDelay
  return Math.floor(Math.random() * cappedDelay);
}

/**
 * Execute an async operation with bounded retries, exponential backoff, and jitter.
 *
 * @param action  - Function to execute, accepting current attempt number (1-based).
 * @param options - Retry configuration parameters.
 * @returns Result of the action once successful.
 * @throws The last encountered error if attempts are exhausted or non-retryable.
 */
export async function withRetry<T>(
  action: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 100);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 5000);
  const multiplier = Math.max(1, options.backoffMultiplier ?? 2);
  const jitter = options.jitter ?? true;
  const isIdempotent = options.isIdempotent ?? true;
  const retryableCheck = options.isRetryable ?? isTransientError;
  const sleepFn = options.sleep ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action(attempt);
    } catch (err) {
      lastError = err;

      // 1. If operation is not idempotent, never retry
      if (!isIdempotent) {
        logger.debug(
          { attempt, error: err },
          "[withRetry] non-idempotent operation failed; skipping retries",
        );
        throw err;
      }

      // 2. If this was the last allowed attempt, do not sleep; rethrow
      if (attempt >= maxAttempts) {
        logger.debug(
          { attempt, maxAttempts, error: err },
          "[withRetry] max attempts exhausted",
        );
        break;
      }

      // 3. If error is non-retryable (e.g. 400 bad request, 404), do not retry
      if (!retryableCheck(err)) {
        logger.debug(
          { attempt, error: err },
          "[withRetry] non-retryable error encountered; aborting further attempts",
        );
        throw err;
      }

      // 4. Calculate delay and sleep
      const delayMs = calculateBackoffDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        multiplier,
        jitter,
      );

      if (options.onRetry) {
        options.onRetry(err, attempt, delayMs);
      }

      await sleepFn(delayMs);
    }
  }

  throw lastError;
}
