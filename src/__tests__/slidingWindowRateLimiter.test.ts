import express, { type Request, type Response } from "express";
import request from "supertest";
import {
  InMemorySlidingWindowStore,
  SlidingWindowRateLimiter,
  createRateLimitMiddleware,
  resolveRateLimitKey,
} from "../rateLimit";

describe("Sliding-Window Rate Limiter — Unit & Store Logic", () => {
  const WINDOW_MS = 60_000;
  const LIMIT = 10;

  let store: InMemorySlidingWindowStore;
  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    store = new InMemorySlidingWindowStore({ maxKeys: 100 });
    limiter = new SlidingWindowRateLimiter({ windowMs: WINDOW_MS, limit: LIMIT }, store);
  });

  it("Edge Case 1: requests under the limit -> allowed with correct remaining", async () => {
    const key = "tenant-1";
    const now = 100_000;

    for (let i = 1; i <= LIMIT; i++) {
      const result = await limiter.consume(key, now);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(LIMIT);
      expect(result.remaining).toBe(LIMIT - i);
      expect(result.retryAfter).toBe(0);
      expect(result.resetTime).toBe(Math.ceil((Math.floor(now / WINDOW_MS) * WINDOW_MS + WINDOW_MS) / 1000));
    }
  });

  it("Edge Case 4: limit exceeded -> 429 with Retry-After", async () => {
    const key = "tenant-limit";
    const now = 100_000;

    // Exhaust limit
    for (let i = 0; i < LIMIT; i++) {
      const res = await limiter.consume(key, now);
      expect(res.allowed).toBe(true);
    }

    // 11th request exceeds limit
    const exceeded = await limiter.consume(key, now);
    expect(exceeded.allowed).toBe(false);
    expect(exceeded.remaining).toBe(0);
    expect(exceeded.retryAfter).toBeGreaterThanOrEqual(1);

    // Further requests continue to be rejected
    const blockedAgain = await limiter.consume(key, now);
    expect(blockedAgain.allowed).toBe(false);
  });

  it("Edge Case 2: burst across a window boundary -> still bounded (no 2x burst)", async () => {
    const key = "tenant-burst";
    // Place window 0 between [60_000, 120_000)
    // Send 10 requests at t = 110_000 (near end of window 0)
    const t0 = 110_000;
    for (let i = 0; i < LIMIT; i++) {
      const res = await limiter.consume(key, t0);
      expect(res.allowed).toBe(true);
    }

    // Move to t = 125_000 (window 1 has just started, 5s elapsed out of 60s)
    // In a fixed-window limiter, all 10 requests would be allowed again (20 requests in 15s!).
    // In our sliding window limiter, prior window weight = 1 - (5000/60000) = 0.916
    // Prior weighted count = floor(10 * 0.916) = 9.
    // So only (10 - 9) = 1 request is allowed before being capped!
    const t1 = 125_000;
    const req1 = await limiter.consume(key, t1);
    expect(req1.allowed).toBe(true);

    const req2 = await limiter.consume(key, t1);
    // MUST be bounded and rejected!
    expect(req2.allowed).toBe(false);
    expect(req2.remaining).toBe(0);
    expect(req2.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("Edge Case 3: two tenants -> independent budgets", async () => {
    const tenantA = "tenant-alpha";
    const tenantB = "tenant-beta";
    const now = 200_000;

    // Tenant A exhausts full budget
    for (let i = 0; i < LIMIT; i++) {
      const resA = await limiter.consume(tenantA, now);
      expect(resA.allowed).toBe(true);
    }
    const blockedA = await limiter.consume(tenantA, now);
    expect(blockedA.allowed).toBe(false);

    // Tenant B must have full untouched quota!
    const resB = await limiter.consume(tenantB, now);
    expect(resB.allowed).toBe(true);
    expect(resB.remaining).toBe(LIMIT - 1);
  });

  it("Edge Case 5: counter resets after the window", async () => {
    const key = "tenant-reset";
    const now = 300_000;

    // Exhaust limit
    for (let i = 0; i < LIMIT; i++) {
      await limiter.consume(key, now);
    }
    expect((await limiter.consume(key, now)).allowed).toBe(false);

    // Advance clock past the window and previous window (> 2 full windows)
    const futureTime = now + WINDOW_MS * 2 + 1000;
    const resAfterWindow = await limiter.consume(key, futureTime);
    expect(resAfterWindow.allowed).toBe(true);
    expect(resAfterWindow.remaining).toBe(LIMIT - 1);
  });

  it("inspects current usage without incrementing via getUsage", async () => {
    const key = "tenant-inspect";
    const now = 400_000;

    const initial = await limiter.getUsage(key, now);
    expect(initial.allowed).toBe(true);
    expect(initial.remaining).toBe(LIMIT);
    expect(initial.currentUsage).toBe(0);

    await limiter.consume(key, now);
    const afterOne = await limiter.getUsage(key, now);
    expect(afterOne.currentUsage).toBe(1);
    expect(afterOne.remaining).toBe(LIMIT - 1);
  });

  it("prunes inactive buckets and evicts on LRU capacity", () => {
    const tinyStore = new InMemorySlidingWindowStore({ maxKeys: 3 });
    const now = 500_000;

    tinyStore.consume("key1", now, WINDOW_MS, 10);
    tinyStore.consume("key2", now, WINDOW_MS, 10);
    tinyStore.consume("key3", now, WINDOW_MS, 10);
    expect(tinyStore.size()).toBe(3);

    // Inserting 4th key evicts the oldest key (key1)
    tinyStore.consume("key4", now, WINDOW_MS, 10);
    expect(tinyStore.size()).toBe(3);

    // Prune buckets older than 2 windows
    const future = now + WINDOW_MS * 3;
    const pruned = tinyStore.prune(future, WINDOW_MS);
    expect(pruned).toBe(3);
    expect(tinyStore.size()).toBe(0);
  });

  it("supports dynamic updates to limit and window size", async () => {
    const key = "tenant-dynamic";
    const now = 600_000;

    limiter.updateOptions({ limit: 2 });
    expect((await limiter.consume(key, now)).allowed).toBe(true);
    expect((await limiter.consume(key, now)).allowed).toBe(true);
    expect((await limiter.consume(key, now)).allowed).toBe(false);

    // Dynamically expand limit
    limiter.updateOptions({ limit: 5 });
    expect((await limiter.consume(key, now)).allowed).toBe(true);
  });
});

describe("Sliding-Window Rate Limiter — HTTP Middleware Integration", () => {
  const WINDOW_MS = 60_000;
  const LIMIT = 3;

  const buildTestApp = () => {
    const app = express();
    const limiter = new SlidingWindowRateLimiter({ windowMs: WINDOW_MS, limit: LIMIT });
    app.use(createRateLimitMiddleware({ limiter, skipInTest: false }));
    app.get("/api/v1/test", (_req: Request, res: Response) => {
      res.json({ message: "success" });
    });
    return app;
  };

  it("exposes X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .get("/api/v1/test")
      .set("x-tenant-id", "org_acme");

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe(String(LIMIT));
    expect(res.headers["x-ratelimit-remaining"]).toBe(String(LIMIT - 1));
    expect(res.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("scopes rate limit independently by API key (x-api-key header)", async () => {
    const app = buildTestApp();
    const key1 = "srk_alpha1111111";
    const key2 = "srk_beta22222222";

    // Consume all 3 requests for key1
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).get("/api/v1/test").set("x-api-key", key1);
      expect(res.status).toBe(200);
    }

    // 4th request for key1 should be 429
    const resBlocked = await request(app).get("/api/v1/test").set("x-api-key", key1);
    expect(resBlocked.status).toBe(429);
    expect(resBlocked.body.code).toBe("rate_limited");
    expect(resBlocked.headers["retry-after"]).toBeDefined();

    // key2 should remain completely unblocked
    const resKey2 = await request(app).get("/api/v1/test").set("x-api-key", key2);
    expect(resKey2.status).toBe(200);
    expect(resKey2.headers["x-ratelimit-remaining"]).toBe(String(LIMIT - 1));
  });

  it("scopes rate limit by Authorization Bearer token", async () => {
    const app = buildTestApp();
    const bearerKey = "srk_bearerkey33333";

    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app)
        .get("/api/v1/test")
        .set("Authorization", `Bearer ${bearerKey}`);
      expect(res.status).toBe(200);
    }

    const resBlocked = await request(app)
      .get("/api/v1/test")
      .set("Authorization", `Bearer ${bearerKey}`);
    expect(resBlocked.status).toBe(429);
  });

  it("resolves key identity correctly across formats", () => {
    const mockReqBearer = {
      header: (name: string) => (name === "authorization" ? "Bearer srk_secrettoken123" : undefined),
      headers: {},
      ip: "127.0.0.1",
      socket: {},
    } as unknown as Request;
    expect(resolveRateLimitKey(mockReqBearer)).toBe("key:srk_secr");

    const mockReqApiKey = {
      header: (name: string) => (name === "x-api-key" ? "srk_apikey456789" : undefined),
      headers: {},
      ip: "127.0.0.1",
      socket: {},
    } as unknown as Request;
    expect(resolveRateLimitKey(mockReqApiKey)).toBe("key:srk_apik");

    const mockReqTenant = {
      header: (name: string) => (name === "x-tenant-id" ? "tenant_123" : undefined),
      headers: {},
      ip: "127.0.0.1",
      socket: {},
    } as unknown as Request;
    expect(resolveRateLimitKey(mockReqTenant)).toBe("tenant:tenant_123");

    const mockReqIp = {
      header: () => undefined,
      headers: {},
      ip: "192.168.1.50",
      socket: {},
    } as unknown as Request;
    expect(resolveRateLimitKey(mockReqIp)).toBe("ip:192.168.1.50");
  });
});
