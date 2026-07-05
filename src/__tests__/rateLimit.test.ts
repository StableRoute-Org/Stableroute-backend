import request from "supertest";
import app, { evictRateBuckets, parseTrustProxy, pruneExpiredRateBuckets } from "../index";
import { rateBuckets, RATE_BUCKETS_MAX_IPS, resetStores } from "../stores";

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
});
