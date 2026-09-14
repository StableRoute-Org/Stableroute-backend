import { describe, it, expect } from "vitest";
import { SlidingWindowRateLimiter } from "../utils/rateLimiter";

describe("SlidingWindowRateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new SlidingWindowRateLimiter(3, 60000);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
  });

  it("blocks requests over limit", () => {
    const limiter = new SlidingWindowRateLimiter(2, 60000);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(false);
  });

  it("tracks remaining correctly", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60000);
    limiter.isAllowed("user1");
    limiter.isAllowed("user1");
    expect(limiter.getRemaining("user1")).toBe(3);
  });

  it("resets for a key", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60000);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(false);
    limiter.reset("user1");
    expect(limiter.isAllowed("user1")).toBe(true);
  });

  it("scopes per key", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60000);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user2")).toBe(true); // different key
  });
});
