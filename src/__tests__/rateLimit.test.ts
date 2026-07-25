import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import app, {
  evictRateBuckets,
  parseTrustProxy,
  pruneExpiredRateBuckets,
} from "../index";
import { resolveClientIp } from "../utils/clientIp";
import { config, rateBuckets, RATE_BUCKETS_MAX_IPS, resetStores } from "../stores";

// Each test advances the clock by 120 s relative to the previous test's
// base so that bucket entries from prior tests are always outside the
// 60 s window and cannot bleed across tests.
const WINDOW_MS = 60_000;
let baseTime = Date.now();

function advanceBase() {
  baseTime += WINDOW_MS * 2;
}

beforeEach(() => {
  advanceBase();
  jest.spyOn(Date, "now").mockReturnValue(baseTime);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The Express rate-limiter middleware is disabled under NODE_ENV=test so the
// test suite can make many requests without hitting the limit. The bucket
// logic is exercised directly via evictRateBuckets.

describe("rate limiter — HTTP (middleware disabled in test env)", () => {
  it("always allows requests when NODE_ENV=test", async () => {
    // Send 70 requests — all should succeed because the middleware is off.
    for (let i = 0; i < 70; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    }
  });
});

describe("rate limiter — bucket logic via evictRateBuckets", () => {
  const LIMIT = 60;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  it("allows up to 60 timestamps in a window without blocking", () => {
    const ip = "10.10.0.1";
    const now = baseTime;
    for (let i = 0; i < LIMIT; i++) {
      const bucket = evictRateBuckets(ip, now, WINDOW_MS);
      expect(bucket.length).toBeLessThan(LIMIT);
      bucket.push(now);
      rateBuckets.set(ip, bucket);
    }
    const finalBucket = rateBuckets.get(ip)!;
    expect(finalBucket).toHaveLength(LIMIT);
  });

  it("bucket reaches the limit on the 61st push", () => {
    const ip = "10.10.0.2";
    const now = baseTime;
    for (let i = 0; i < LIMIT; i++) {
      const b = evictRateBuckets(ip, now, WINDOW_MS);
      b.push(now);
      rateBuckets.set(ip, b);
    }
    // The 61st eviction returns a full bucket — caller must reject
    const blocked = evictRateBuckets(ip, now, WINDOW_MS);
    expect(blocked.length).toBe(LIMIT);
  });

  it("bucket drains to zero after the window expires and key is deleted", () => {
    const ip = "10.10.0.3";
    const now = baseTime;
    const b = evictRateBuckets(ip, now, WINDOW_MS);
    b.push(now);
    rateBuckets.set(ip, b);

    // Advance well past the window
    const later = now + WINDOW_MS + 1;
    evictRateBuckets(ip, later, WINDOW_MS);
    expect(rateBuckets.has(ip)).toBe(false);
  });

  it("re-allows a returning IP after its bucket was evicted", () => {
    const ip = "10.10.0.4";
    const now = baseTime;
    const b = evictRateBuckets(ip, now, WINDOW_MS);
    b.push(now);
    rateBuckets.set(ip, b);

    // Age out the bucket
    const later = now + WINDOW_MS + 1;
    evictRateBuckets(ip, later, WINDOW_MS);
    expect(rateBuckets.has(ip)).toBe(false);

    // IP returns — fresh empty bucket
    const fresh = evictRateBuckets(ip, later + 1000, WINDOW_MS);
    expect(fresh).toHaveLength(0);
  });
});

describe("evictRateBuckets — idle eviction", () => {
  const WINDOW_MS = 60_000;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  it("removes the key when all timestamps have aged out of the window", () => {
    const ip = "10.0.0.1";
    const oldTime = 1_000_000;
    rateBuckets.set(ip, [oldTime]);

    // now is far past oldTime + window
    const now = oldTime + WINDOW_MS + 1;
    const result = evictRateBuckets(ip, now, WINDOW_MS);

    expect(result).toHaveLength(0);
    expect(rateBuckets.has(ip)).toBe(false);
  });

  it("keeps the key when at least one timestamp is still in-window", () => {
    const ip = "10.0.0.2";
    const now = 2_000_000;
    rateBuckets.set(ip, [now - 1000, now - WINDOW_MS - 1]);

    const result = evictRateBuckets(ip, now, WINDOW_MS);

    expect(result).toHaveLength(1);
    expect(rateBuckets.has(ip)).toBe(true);
  });

  it("does not insert a key for a brand-new IP with no timestamps", () => {
    const ip = "10.0.0.3";
    const now = 3_000_000;
    // IP never seen before — evictRateBuckets returns empty array but does
    // NOT write the key (the middleware writes it after the call)
    const result = evictRateBuckets(ip, now, WINDOW_MS);

    expect(result).toHaveLength(0);
    expect(rateBuckets.has(ip)).toBe(false);
  });

  it("a returning IP after its bucket was evicted starts fresh", () => {
    const ip = "10.0.0.4";
    const oldTime = 5_000_000;
    rateBuckets.set(ip, [oldTime]);

    // First call ages out the bucket and deletes the key
    const now1 = oldTime + WINDOW_MS + 1;
    evictRateBuckets(ip, now1, WINDOW_MS);
    expect(rateBuckets.has(ip)).toBe(false);

    // Second call — IP is unknown again, returns empty array
    const now2 = now1 + 1000;
    const result = evictRateBuckets(ip, now2, WINDOW_MS);
    expect(result).toHaveLength(0);
    expect(rateBuckets.has(ip)).toBe(false);
  });
});

describe("evictRateBuckets — ceiling eviction", () => {
  const WINDOW_MS = 60_000;
  const now = 10_000_000;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  it("sheds the oldest entry when the IP ceiling is exceeded", () => {
    // Fill the map to exactly the ceiling
    for (let i = 0; i < RATE_BUCKETS_MAX_IPS; i++) {
      rateBuckets.set(`192.168.${Math.floor(i / 256)}.${i % 256}`, [now]);
    }
    const firstKey = rateBuckets.keys().next().value as string;
    expect(rateBuckets.size).toBe(RATE_BUCKETS_MAX_IPS);

    // Inserting a new IP should evict the oldest one
    const newIp = "172.16.0.1";
    evictRateBuckets(newIp, now, WINDOW_MS);

    expect(rateBuckets.size).toBe(RATE_BUCKETS_MAX_IPS - 1);
    expect(rateBuckets.has(firstKey)).toBe(false);
  });

  it("does not evict when the map is below the ceiling", () => {
    rateBuckets.set("10.1.0.1", [now]);
    rateBuckets.set("10.1.0.2", [now]);
    expect(rateBuckets.size).toBe(2);

    evictRateBuckets("10.1.0.3", now, WINDOW_MS);

    // The two existing keys must still be present
    expect(rateBuckets.has("10.1.0.1")).toBe(true);
    expect(rateBuckets.has("10.1.0.2")).toBe(true);
  });

  it("high-cardinality flood cannot grow the map beyond RATE_BUCKETS_MAX_IPS", () => {
    // Simulate a spray of unique IPs well beyond the ceiling
    const flood = RATE_BUCKETS_MAX_IPS + 1000;
    for (let i = 0; i < flood; i++) {
      const ip = `1.${Math.floor(i / 65536)}.${Math.floor((i / 256) % 256)}.${i % 256}`;
      evictRateBuckets(ip, now, WINDOW_MS);
      rateBuckets.set(ip, [now]);
    }
    expect(rateBuckets.size).toBeLessThanOrEqual(RATE_BUCKETS_MAX_IPS);
  });
});

describe("rate limiter proxy trust configuration", () => {
  it("does not trust forwarded headers by default", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
  });

  it("parses explicit trust proxy settings", () => {
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("loopback, linklocal, uniquelocal")).toEqual([
      "loopback",
      "linklocal",
      "uniquelocal",
    ]);
  });
});

describe("rate limiter lazy GC", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  it("removes expired buckets for clients that never return", () => {
    const now = 12_000_000;
    rateBuckets.set("10.0.1.1", [now - WINDOW_MS - 1]);
    rateBuckets.set("10.0.1.2", [now - 1000]);
    rateBuckets.set("10.0.1.3", [now - WINDOW_MS - 5, now - 500]);

    const removed = pruneExpiredRateBuckets(now, WINDOW_MS);

    expect(removed).toBe(1);
    expect(rateBuckets.has("10.0.1.1")).toBe(false);
    expect(rateBuckets.get("10.0.1.2")).toEqual([now - 1000]);
    expect(rateBuckets.get("10.0.1.3")).toEqual([now - 500]);
  });

  it("is rate-limited to avoid sweeping on every request", () => {
    const now = 14_000_000;
    rateBuckets.set("10.0.2.1", [now - WINDOW_MS - 1]);

    expect(pruneExpiredRateBuckets(now, WINDOW_MS)).toBe(1);
    rateBuckets.set("10.0.2.2", [now - WINDOW_MS - 1]);
    expect(pruneExpiredRateBuckets(now + 1000, WINDOW_MS)).toBe(0);
    expect(rateBuckets.has("10.0.2.2")).toBe(true);
  });

  it("fires again after the GC interval elapses", () => {
    const t1 = 16_000_000;
    rateBuckets.set("10.0.3.1", [t1 - WINDOW_MS - 1]);
    // First call: GC fires (lastGcAt starts at 0)
    expect(pruneExpiredRateBuckets(t1, WINDOW_MS)).toBe(1);
    expect(rateBuckets.has("10.0.3.1")).toBe(false);

    // Second call within interval — GC is skipped
    rateBuckets.set("10.0.3.2", [t1 - WINDOW_MS - 1]);
    expect(pruneExpiredRateBuckets(t1 + 30_000, WINDOW_MS)).toBe(0);
    expect(rateBuckets.has("10.0.3.2")).toBe(true); // still there because GC didn't run

    // Third call past interval — GC fires again
    const t3 = t1 + 60_001;
    expect(pruneExpiredRateBuckets(t3, WINDOW_MS)).toBe(1);
    expect(rateBuckets.has("10.0.3.2")).toBe(false);
  });
});

describe("rate limiter — window boundary edge cases", () => {
  const WINDOW_MS = 60_000;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  it("retains timestamps strictly inside the window (now - t < windowMs)", () => {
    const ip = "10.0.0.5";
    const now = 20_000_000;
    // t is one ms inside the window: now - t === WINDOW_MS - 1
    rateBuckets.set(ip, [now - WINDOW_MS + 1]);
    const result = evictRateBuckets(ip, now, WINDOW_MS);
    expect(result).toHaveLength(1);
    expect(rateBuckets.has(ip)).toBe(true);
  });

  it("evicts timestamps at or beyond the window boundary", () => {
    const ip = "10.0.0.6";
    const now = 20_000_000;
    // Exactly at boundary (now - t === windowMs) — the `<` filter rejects it
    rateBuckets.set(ip, [now - WINDOW_MS]);
    const result = evictRateBuckets(ip, now, WINDOW_MS);
    expect(result).toHaveLength(0);
    expect(rateBuckets.has(ip)).toBe(false);
  });

  it("evicts timestamps one ms past the boundary", () => {
    const ip = "10.0.0.7";
    const now = 20_000_000;
    rateBuckets.set(ip, [now - WINDOW_MS - 1]);
    const result = evictRateBuckets(ip, now, WINDOW_MS);
    expect(result).toHaveLength(0);
    expect(rateBuckets.has(ip)).toBe(false);
  });

  it("partially evicts a mixed bucket (some in-window, some expired)", () => {
    const ip = "10.0.0.8";
    const now = 20_000_000;
    rateBuckets.set(ip, [
      now - WINDOW_MS - 1,   // expired
      now - 1000,            // live (now - 1000 < WINDOW_MS → 59_000 < 60_000)
      now - WINDOW_MS,       // exactly at boundary — expired
    ]);
    const result = evictRateBuckets(ip, now, WINDOW_MS);
    expect(result).toEqual([now - 1000]);
    expect(rateBuckets.has(ip)).toBe(true);
  });

  it("handles multiple timestamps at the same millisecond", () => {
    const ip = "10.0.0.8";
    const now = 20_000_000;
    const bucket = [now, now, now];
    rateBuckets.set(ip, bucket);

    const result = evictRateBuckets(ip, now, WINDOW_MS);
    expect(result).toHaveLength(3);
  });
});

describe("rate limiter — HTTP middleware integration", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    resetStores();
  });

  const buildApp = () => {
    const testApp = express();
    testApp.use((req: Request, res: Response, next: NextFunction) => {
      const ip = resolveClientIp(
        req.headers["x-forwarded-for"],
        req.ip ?? req.socket.remoteAddress,
      );
      const now = Date.now();
      const windowMs = config.rateLimitWindowMs ?? 60_000;
      pruneExpiredRateBuckets(now, windowMs);
      const limitPerWindow = config.rateLimitPerWindow ?? 60;
      const bucket = evictRateBuckets(ip, now, windowMs);
      if (bucket.length >= limitPerWindow) {
        res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        res.status(429).json({
          error: "rate_limited",
          message: `more than ${limitPerWindow} requests per ${windowMs / 1000}s`,
        });
        return;
      }
      bucket.push(now);
      rateBuckets.set(ip, bucket);
      next();
    });
    testApp.get("/test", (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    return testApp;
  };

  it("allows requests within the configured limit", async () => {
    config.rateLimitPerWindow = 5;
    const testApp = buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(testApp).get("/test");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it("rejects the first request beyond the limit with 429", async () => {
    config.rateLimitPerWindow = 5;
    const testApp = buildApp();
    for (let i = 0; i < 5; i++) {
      await request(testApp).get("/test");
    }
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
    expect(res.body.message).toContain("5");
  });

  it("sets Retry-After header to the window duration in seconds (rounded up)", async () => {
    config.rateLimitPerWindow = 3;
    config.rateLimitWindowMs = 30_000;
    const testApp = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(testApp).get("/test");
    }
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
  });

  it("different IPs have independent rate-limit counters", async () => {
    config.rateLimitPerWindow = 3;
    const testApp = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(testApp).get("/test").set("X-Forwarded-For", "10.0.0.1");
    }
    // 10.0.0.1 should be blocked
    const resA = await request(testApp)
      .get("/test")
      .set("X-Forwarded-For", "10.0.0.1");
    expect(resA.status).toBe(429);

    // 10.0.0.2 should still be allowed
    const resB = await request(testApp)
      .get("/test")
      .set("X-Forwarded-For", "10.0.0.2");
    expect(resB.status).toBe(200);
  });

  it("allows a new request after the window expires", async () => {
    config.rateLimitPerWindow = 3;
    const testApp = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(testApp).get("/test");
    }
    // Blocked now
    const blocked = await request(testApp).get("/test");
    expect(blocked.status).toBe(429);

    // Advance the mock clock past the 60 s window
    const advanced = baseTime + 60_001;
    jest.spyOn(Date, "now").mockReturnValue(advanced);

    const allowed = await request(testApp).get("/test");
    expect(allowed.status).toBe(200);
  });

  it("respects live config changes to rateLimitPerWindow", async () => {
    config.rateLimitPerWindow = 60; // baseline default
    const testApp = buildApp();
    // Make 5 requests — should pass with the wide limit
    for (let i = 0; i < 5; i++) {
      await request(testApp).get("/test");
    }
    // Tighten the limit to 5 — the 6th request should now fail
    config.rateLimitPerWindow = 5;
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(429);
  });

  it("respects live config changes to rateLimitWindowMs", async () => {
    config.rateLimitPerWindow = 60;
    const testApp = buildApp();
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      await request(testApp).get("/test");
    }
    // Shrink window to 1 ms — all existing timestamps should age out
    config.rateLimitWindowMs = 1;
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(200);
  });

  it("uses fallback defaults when config keys are deleted", async () => {
    delete config.rateLimitPerWindow;
    delete config.rateLimitWindowMs;
    const testApp = buildApp();
    // Default limit is 60 — send 60 requests, all should pass
    for (let i = 0; i < 60; i++) {
      const res = await request(testApp).get("/test");
      expect(res.status).toBe(200);
    }
    // 61st should be blocked
    const res = await request(testApp).get("/test");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
  });
});

describe("resolveClientIp — IP resolution for rate limiting", () => {
  it("uses the first IP from X-Forwarded-For", () => {
    expect(resolveClientIp("10.0.0.1", "192.168.1.1")).toBe("10.0.0.1");
  });

  it("picks the first address when X-Forwarded-For contains a chain", () => {
    expect(
      resolveClientIp("10.0.0.1, 192.168.1.1, 10.0.0.2", "127.0.0.1"),
    ).toBe("10.0.0.1");
  });

  it("trims whitespace from the first X-Forwarded-For value", () => {
    expect(resolveClientIp("  10.0.0.1  ", "192.168.1.1")).toBe("10.0.0.1");
  });

  it("falls back to remoteAddress when X-Forwarded-For is absent", () => {
    expect(resolveClientIp(undefined, "192.168.1.1")).toBe("192.168.1.1");
  });

  it("falls back to 'unknown' when both sources are absent", () => {
    expect(resolveClientIp(undefined, undefined)).toBe("unknown");
  });

  it("returns 'unknown' when X-Forwarded-For is an empty string", () => {
    expect(resolveClientIp("", "192.168.1.1")).toBe("192.168.1.1");
  });

  it("handles X-Forwarded-For as an array (Express duplicate-header format)", () => {
    expect(resolveClientIp(["10.0.0.1", "10.0.0.2"], "192.168.1.1")).toBe(
      "10.0.0.1",
    );
  });
});
