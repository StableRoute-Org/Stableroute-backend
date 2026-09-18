/**
 * Circuit Breaker implementation for external dependencies (e.g. Price Oracle).
 *
 * Implements the standard three-state finite state machine:
 *
 *           failure threshold exceeded
 *   CLOSED ────────────────────────────> OPEN
 *     ▲                                    │
 *     │ probe success           cooldown   │
 *     │                        elapsed     │
 *     │                                    ▼
 *   HALF_OPEN <────────────────────────────┘
 *     │
 *     │ probe failure
 *     └────────────────────────────────> OPEN
 *
 * Guarantees:
 * - Per-dependency isolation (state is tracked per named dependency, never globally).
 * - Thread/event-loop safe in synchronous or asynchronous JavaScript execution.
 * - Emits structured logs on state transitions.
 * - Fails fast with typed `upstream_unavailable` error when in OPEN state.
 *
 * @module oracle/circuitBreaker
 */

import { logger } from "../logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures that triggers state transition to OPEN. Defaults to 5. */
  failureThreshold?: number | undefined;
  /** Cooldown duration in milliseconds before an OPEN breaker allows a probe call in HALF_OPEN. Defaults to 30,000 ms. */
  cooldownMs?: number | undefined;
  /** Maximum number of probe calls allowed in HALF_OPEN state. Defaults to 1. */
  halfOpenMaxCalls?: number | undefined;
}

export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  totalShortCircuits: number;
  lastFailureTime: number | null;
  lastStateChange: number;
}

export class CircuitBreakerOpenError extends Error {
  readonly code = "upstream_unavailable";
  readonly status = 503;
  readonly dependency: string;

  constructor(dependency: string, message?: string) {
    super(
      message ??
        `upstream service '${dependency}' is currently unavailable (circuit breaker OPEN)`,
    );
    this.name = "CircuitBreakerOpenError";
    this.dependency = dependency;
  }
}

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalShortCircuits = 0;
  private lastFailureTime: number | null = null;
  private lastStateChange: number = Date.now();
  private halfOpenCalls = 0;

  private failureThreshold: number;
  private cooldownMs: number;
  private halfOpenMaxCalls: number;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30000;
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1;
  }

  /** Update breaker thresholds and intervals at runtime. */
  updateOptions(options: Partial<CircuitBreakerOptions>): void {
    if (options.failureThreshold !== undefined) {
      this.failureThreshold = Math.max(1, options.failureThreshold);
    }
    if (options.cooldownMs !== undefined) {
      this.cooldownMs = Math.max(0, options.cooldownMs);
    }
    if (options.halfOpenMaxCalls !== undefined) {
      this.halfOpenMaxCalls = Math.max(1, options.halfOpenMaxCalls);
    }
  }

  /**
   * Execute an asynchronous action through the circuit breaker.
   *
   * - If CLOSED: executes action directly.
   * - If OPEN: checks if cooldown has elapsed.
   *   - If yes: transitions to HALF_OPEN and executes probe.
   *   - If no: fails fast with {@link CircuitBreakerOpenError}.
   * - If HALF_OPEN: allows up to `halfOpenMaxCalls` probes.
   *   - On probe success: transitions to CLOSED.
   *   - On probe failure: transitions back to OPEN.
   */
  async execute<T>(action: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Check if cooldown has elapsed on an OPEN breaker
    if (this.state === "OPEN") {
      if (this.lastFailureTime !== null && now - this.lastFailureTime >= this.cooldownMs) {
        this.transitionTo("HALF_OPEN");
        this.halfOpenCalls = 0;
      } else {
        this.totalShortCircuits += 1;
        throw new CircuitBreakerOpenError(
          this.name,
          `circuit breaker for '${this.name}' is OPEN (fail-fast)`,
        );
      }
    }

    // Guard HALF_OPEN probe budget
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        this.totalShortCircuits += 1;
        throw new CircuitBreakerOpenError(
          this.name,
          `circuit breaker for '${this.name}' is HALF_OPEN (probe in progress)`,
        );
      }
      this.halfOpenCalls += 1;
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private onSuccess(): void {
    this.totalSuccesses += 1;
    if (this.state === "HALF_OPEN") {
      logger.info(
        { dependency: this.name },
        `[circuit-breaker] probe succeeded for '${this.name}', closing circuit`,
      );
      this.transitionTo("CLOSED");
      this.consecutiveFailures = 0;
      this.halfOpenCalls = 0;
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(error: unknown): void {
    const now = Date.now();
    this.consecutiveFailures += 1;
    this.totalFailures += 1;
    this.lastFailureTime = now;

    if (this.state === "HALF_OPEN") {
      logger.warn(
        { dependency: this.name, error },
        `[circuit-breaker] probe failed for '${this.name}', reopening circuit`,
      );
      this.transitionTo("OPEN");
      this.halfOpenCalls = 0;
      return;
    }

    if (this.state === "CLOSED" && this.consecutiveFailures >= this.failureThreshold) {
      logger.warn(
        {
          dependency: this.name,
          consecutiveFailures: this.consecutiveFailures,
          failureThreshold: this.failureThreshold,
        },
        `[circuit-breaker] failure threshold exceeded for '${this.name}', opening circuit`,
      );
      this.transitionTo("OPEN");
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    logger.info(
      { dependency: this.name, oldState, newState },
      `[circuit-breaker] '${this.name}' transitioned from ${oldState} to ${newState}`,
    );
  }

  /** Current state of the breaker ("CLOSED", "OPEN", or "HALF_OPEN"). */
  getState(): CircuitState {
    // If OPEN and cooldown elapsed, reading state should report HALF_OPEN
    if (
      this.state === "OPEN" &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.cooldownMs
    ) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  /** Force state for testing and administrative resets. */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === "CLOSED") {
      this.consecutiveFailures = 0;
      this.halfOpenCalls = 0;
    }
  }

  /** Reset internal state back to factory default (CLOSED). */
  reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.totalFailures = 0;
    this.totalSuccesses = 0;
    this.totalShortCircuits = 0;
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.halfOpenCalls = 0;
  }

  /** Export metrics snapshot for monitoring / Prometheus exposition. */
  getMetrics(): CircuitBreakerMetrics {
    return {
      name: this.name,
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalShortCircuits: this.totalShortCircuits,
      lastFailureTime: this.lastFailureTime,
      lastStateChange: this.lastStateChange,
    };
  }
}

/**
 * Registry maintaining isolated circuit breaker instances per dependency.
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(name, options);
      this.breakers.set(name, breaker);
    } else if (options) {
      breaker.updateOptions(options);
    }
    return breaker;
  }

  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  clear(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    this.breakers.clear();
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
