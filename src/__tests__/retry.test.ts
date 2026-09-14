import { describe, it, expect, vi } from "vitest";
import { withRetry, CircuitBreaker } from "../utils/retry";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const result = await withRetry(async () => "success");
    expect(result).toBe("success");
  });

  it("retries on failure then succeeds", async () => {
    let attempts = 0;
    const result = withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail");
      return "success";
    }, { baseDelayMs: 10 });
    expect(await result).toBe("success");
    expect(attempts).toBe(2);
  });

  it("throws after max retries", async () => {
    let attempts = 0;
    const result = withRetry(async () => {
      attempts++;
      throw new Error("always fail");
    }, { maxRetries: 2, baseDelayMs: 10 });
    await expect(result).rejects.toThrow("always fail");
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe("CircuitBreaker", () => {
  it("starts closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("CLOSED");
  });

  it("opens after failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });
    const failingFn = async () => { throw new Error("fail"); };

    await expect(cb.execute(failingFn)).rejects.toThrow();
    await expect(cb.execute(failingFn)).rejects.toThrow();
    
    // Circuit should be open now
    expect(cb.getState()).toBe("OPEN");
    await expect(cb.execute(failingFn)).rejects.toThrow("Circuit breaker is OPEN");
  });

  it("executes when closed", async () => {
    const cb = new CircuitBreaker();
    const result = await cb.execute(async () => "ok");
    expect(result).toBe("ok");
  });
});
