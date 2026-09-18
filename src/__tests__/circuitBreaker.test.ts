import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  circuitBreakerRegistry,
} from "../oracle/circuitBreaker";
import {
  withRetry,
  calculateBackoffDelay,
  isTransientError,
} from "../oracle/retry";

describe("Circuit Breaker & Retry Resiliency", () => {
  beforeEach(() => {
    circuitBreakerRegistry.resetAll();
  });

  describe("calculateBackoffDelay & isTransientError", () => {
    it("computes deterministic exponential backoff when jitter is false", () => {
      const base = 100;
      const max = 2000;
      const mult = 2;

      // attempt 1: 100 * 2^0 = 100
      expect(calculateBackoffDelay(1, base, max, mult, false)).toBe(100);
      // attempt 2: 100 * 2^1 = 200
      expect(calculateBackoffDelay(2, base, max, mult, false)).toBe(200);
      // attempt 3: 100 * 2^2 = 400
      expect(calculateBackoffDelay(3, base, max, mult, false)).toBe(400);
      // attempt 4: 100 * 2^3 = 800
      expect(calculateBackoffDelay(4, base, max, mult, false)).toBe(800);
      // attempt 5: 100 * 2^4 = 1600
      expect(calculateBackoffDelay(5, base, max, mult, false)).toBe(1600);
      // attempt 6: 100 * 2^5 = 3200 -> capped at 2000
      expect(calculateBackoffDelay(6, base, max, mult, false)).toBe(2000);
    });

    it("applies full jitter uniformly within [0, cappedInterval]", () => {
      const base = 100;
      const max = 1000;

      for (let i = 0; i < 50; i++) {
        const delay = calculateBackoffDelay(3, base, max, 2, true);
        const maxExpected = Math.min(base * Math.pow(2, 2), max); // 400
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(maxExpected);
      }
    });

    it("accurately classifies transient vs non-retryable errors", () => {
      // Transient network codes
      expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
      expect(isTransientError({ code: "ECONNREFUSED" })).toBe(true);
      expect(isTransientError({ code: "ENOTFOUND" })).toBe(true);

      // Transient HTTP statuses
      expect(isTransientError({ status: 500 })).toBe(true);
      expect(isTransientError({ status: 502 })).toBe(true);
      expect(isTransientError({ status: 503 })).toBe(true);
      expect(isTransientError({ status: 504 })).toBe(true);
      expect(isTransientError({ status: 429 })).toBe(true);

      // Non-retryable HTTP client statuses
      expect(isTransientError({ status: 400 })).toBe(false);
      expect(isTransientError({ status: 401 })).toBe(false);
      expect(isTransientError({ status: 403 })).toBe(false);
      expect(isTransientError({ status: 404 })).toBe(false);
      expect(isTransientError({ status: 422 })).toBe(false);

      // Message heuristics
      expect(isTransientError(new Error("socket hang up"))).toBe(true);
      expect(isTransientError(new Error("gateway timeout"))).toBe(true);
      expect(isTransientError(new TypeError("Cannot read properties of undefined"))).toBe(false);
      expect(isTransientError(null)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("Edge Case 1: transient failure then success -> retried and succeeds", async () => {
      let attempts = 0;
      const mockSleep = jest.fn().mockResolvedValue(undefined);
      const onRetry = jest.fn();

      const action = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          const err = new Error("network timeout");
          (err as unknown as { code: string }).code = "ETIMEDOUT";
          throw err;
        }
        return "success_val";
      });

      const result = await withRetry(action, {
        maxAttempts: 4,
        baseDelayMs: 10,
        sleep: mockSleep,
        onRetry,
      });

      expect(result).toBe("success_val");
      expect(action).toHaveBeenCalledTimes(3);
      expect(mockSleep).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("Edge Case 4: non-retryable error -> fails fast without retry", async () => {
      const mockSleep = jest.fn().mockResolvedValue(undefined);
      const action = jest.fn().mockImplementation(async () => {
        const err = new Error("Bad Request: invalid pair");
        (err as unknown as { status: number }).status = 400;
        throw err;
      });

      await expect(
        withRetry(action, {
          maxAttempts: 5,
          sleep: mockSleep,
        }),
      ).rejects.toThrow("Bad Request: invalid pair");

      expect(action).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("Edge Case 5: backoff respects the max attempt bound", async () => {
      const mockSleep = jest.fn().mockResolvedValue(undefined);
      const action = jest.fn().mockImplementation(async () => {
        const err = new Error("Gateway 504");
        (err as unknown as { status: number }).status = 504;
        throw err;
      });

      const maxAttempts = 3;
      await expect(
        withRetry(action, {
          maxAttempts,
          baseDelayMs: 50,
          sleep: mockSleep,
        }),
      ).rejects.toThrow("Gateway 504");

      // Strictly called maxAttempts times (initial try + 2 retries)
      expect(action).toHaveBeenCalledTimes(maxAttempts);
      expect(mockSleep).toHaveBeenCalledTimes(maxAttempts - 1);
    });

    it("skips retries when isIdempotent is false even for transient 500 errors", async () => {
      const mockSleep = jest.fn().mockResolvedValue(undefined);
      const action = jest.fn().mockImplementation(async () => {
        const err = new Error("Internal Server Error");
        (err as unknown as { status: number }).status = 500;
        throw err;
      });

      await expect(
        withRetry(action, {
          maxAttempts: 3,
          isIdempotent: false,
          sleep: mockSleep,
        }),
      ).rejects.toThrow("Internal Server Error");

      expect(action).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });
  });

  describe("CircuitBreaker state machine", () => {
    it("Edge Case 2: N consecutive failures -> breaker opens, calls fail fast", async () => {
      const threshold = 3;
      const breaker = new CircuitBreaker("test-oracle", {
        failureThreshold: threshold,
        cooldownMs: 10_000,
      });

      expect(breaker.getState()).toBe("CLOSED");

      const failingCall = async () => {
        await breaker.execute(async () => {
          throw new Error("upstream 503");
        });
      };

      // 1st failure
      await expect(failingCall()).rejects.toThrow("upstream 503");
      expect(breaker.getState()).toBe("CLOSED");

      // 2nd failure
      await expect(failingCall()).rejects.toThrow("upstream 503");
      expect(breaker.getState()).toBe("CLOSED");

      // 3rd failure -> trips threshold
      await expect(failingCall()).rejects.toThrow("upstream 503");
      expect(breaker.getState()).toBe("OPEN");

      // Next call fails fast with CircuitBreakerOpenError without executing target action
      const targetSpy = jest.fn();
      await expect(
        breaker.execute(async () => {
          targetSpy();
          return "won't run";
        }),
      ).rejects.toThrow(CircuitBreakerOpenError);

      expect(targetSpy).not.toHaveBeenCalled();

      const metrics = breaker.getMetrics();
      expect(metrics.state).toBe("OPEN");
      expect(metrics.consecutiveFailures).toBe(3);
      expect(metrics.totalShortCircuits).toBe(1);
    });

    it("Edge Case 3: cooldown elapses -> half-open probe; success closes it", async () => {
      const cooldownMs = 200;
      const breaker = new CircuitBreaker("cooldown-oracle", {
        failureThreshold: 2,
        cooldownMs,
      });

      // Trip the breaker to OPEN
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error("fail");
          }),
        ).rejects.toThrow("fail");
      }
      expect(breaker.getState()).toBe("OPEN");

      // Immediately should fail fast
      await expect(breaker.execute(async () => "val")).rejects.toThrow(
        CircuitBreakerOpenError,
      );

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, cooldownMs + 20));

      // After cooldown, state transitions to HALF_OPEN and probe is executed
      expect(breaker.getState()).toBe("HALF_OPEN");

      const probeResult = await breaker.execute(async () => {
        return "probe_success";
      });

      expect(probeResult).toBe("probe_success");
      // Succeeded probe resets breaker to CLOSED
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getMetrics().consecutiveFailures).toBe(0);
    });

    it("re-opens immediately if probe fails during HALF_OPEN", async () => {
      const cooldownMs = 100;
      const breaker = new CircuitBreaker("probe-fail-oracle", {
        failureThreshold: 2,
        cooldownMs,
      });

      // Trip to OPEN
      for (let i = 0; i < 2; i++) {
        await expect(
          breaker.execute(async () => {
            throw new Error("fail");
          }),
        ).rejects.toThrow("fail");
      }
      expect(breaker.getState()).toBe("OPEN");

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, cooldownMs + 20));
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Probe fails
      await expect(
        breaker.execute(async () => {
          throw new Error("probe exploded");
        }),
      ).rejects.toThrow("probe exploded");

      // Immediately goes back to OPEN
      expect(breaker.getState()).toBe("OPEN");
    });

    it("limits concurrent probes in HALF_OPEN state", async () => {
      const breaker = new CircuitBreaker("concurrent-probe", {
        failureThreshold: 1,
        cooldownMs: 0, // Immediately eligible for half-open
        halfOpenMaxCalls: 1,
      });

      await expect(
        breaker.execute(async () => {
          throw new Error("trip");
        }),
      ).rejects.toThrow("trip");

      // State is now eligible for HALF_OPEN
      let resolveProbe: (v: string) => void;
      const probePromise = new Promise<string>((res) => {
        resolveProbe = res;
      });

      // Launch probe 1 (hangs until resolveProbe is called)
      const call1 = breaker.execute(() => probePromise);

      // Launch probe 2 while probe 1 is in-flight -> should fail fast
      await expect(breaker.execute(async () => "extra")).rejects.toThrow(
        CircuitBreakerOpenError,
      );

      // Resolve probe 1
      resolveProbe!("done");
      const res1 = await call1;
      expect(res1).toBe("done");
      expect(breaker.getState()).toBe("CLOSED");
    });
  });

  describe("Per-dependency isolation", () => {
    it("maintains isolated state across different upstream services", async () => {
      const breakerA = circuitBreakerRegistry.getBreaker("oracle-alpha", {
        failureThreshold: 2,
      });
      const breakerB = circuitBreakerRegistry.getBreaker("oracle-beta", {
        failureThreshold: 2,
      });

      // Trip breaker A
      for (let i = 0; i < 2; i++) {
        await expect(
          breakerA.execute(async () => {
            throw new Error("alpha down");
          }),
        ).rejects.toThrow("alpha down");
      }

      expect(breakerA.getState()).toBe("OPEN");
      // Breaker B must remain healthy CLOSED!
      expect(breakerB.getState()).toBe("CLOSED");

      // Calls through B succeed unaffected
      const resultB = await breakerB.execute(async () => "beta_ok");
      expect(resultB).toBe("beta_ok");

      // Calls through A fail fast
      await expect(breakerA.execute(async () => "alpha_call")).rejects.toThrow(
        CircuitBreakerOpenError,
      );
    });
  });
});
