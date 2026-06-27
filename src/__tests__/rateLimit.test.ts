import request from "supertest";

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "development";

const {
  default: app,
  parseTrustProxy,
  pruneExpiredRateBuckets,
  resetRateLimiterStateForTests,
} = require("../index") as typeof import("../index");

// Each test advances the clock by 120 s relative to the previous test's
// base so that bucket entries from prior tests are always outside the
// 60 s window and cannot bleed across tests.
const WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_WINDOW = 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
let baseTime = Date.now();

function advanceBase() {
  baseTime += WINDOW_MS * 2;
}

beforeEach(() => {
  advanceBase();
  resetRateLimiterStateForTests();
  jest.spyOn(Date, "now").mockReturnValue(baseTime);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  resetRateLimiterStateForTests();
  await request(app)
    .patch("/api/v1/config")
    .send({
      rateLimitPerWindow: DEFAULT_RATE_LIMIT_PER_WINDOW,
      rateLimitWindowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    });
  resetRateLimiterStateForTests();
  jest.restoreAllMocks();
});

afterAll(() => {
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

describe("rate limiter", () => {
  it("allows exactly 60 requests in one window", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
    }
  });

  it("blocks the 61st request with 429 and rate_limited error", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/health");
    }
    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("includes Retry-After: 60 on the 429 response", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/health");
    }
    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
  });

  it("429 body has error and message fields", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/health");
    }
    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: "rate_limited",
      message: expect.stringContaining("60"),
    });
  });

  it("re-allows requests after the window expires", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/health");
    }

    // Blocked inside the window
    let res = await request(app).get("/health");
    expect(res.status).toBe(429);

    // Advance time past the 60 s window
    jest.spyOn(Date, "now").mockReturnValue(baseTime + WINDOW_MS + 1);

    res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("counts the 429 message body correctly", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/health");
    }
    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/60.*requests.*60s/);
  });

  it("ignores spoofed X-Forwarded-For values unless a proxy is trusted", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app)
        .get("/health")
        .set("X-Forwarded-For", `203.0.113.${i}`);
    }

    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "198.51.100.250");

    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("uses the live config values patched through /api/v1/config", async () => {
    const patch = await request(app)
      .patch("/api/v1/config")
      .send({ rateLimitPerWindow: 2, rateLimitWindowMs: 1000 });
    expect(patch.status).toBe(200);

    resetRateLimiterStateForTests();

    await request(app).get("/health").expect(200);
    await request(app).get("/health").expect(200);

    const res = await request(app).get("/health");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.body.message).toMatch(/2.*requests.*1s/);
  });

  it("parses TRUST_PROXY into Express trust proxy settings", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("loopback, linklocal, uniquelocal")).toEqual([
      "loopback",
      "linklocal",
      "uniquelocal",
    ]);
  });

  it("prunes empty and expired rate-limit buckets", () => {
    const buckets = new Map<string, number[]>([
      ["old", [1000, 2000]],
      ["mixed", [2000, 9500]],
      ["fresh", [9500, 9900]],
    ]);

    pruneExpiredRateBuckets(buckets, 10_000, 1000);

    expect(buckets.has("old")).toBe(false);
    expect(buckets.get("mixed")).toEqual([9500]);
    expect(buckets.get("fresh")).toEqual([9500, 9900]);
  });
});
