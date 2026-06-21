import request from "supertest";
import app from "../index";

// Each test advances the clock by 120 s relative to the previous test's
// base so that bucket entries from prior tests are always outside the
// 60 s window and cannot bleed across tests.
const WINDOW_MS = 60_000;
let baseTime = Date.now();
const originalNodeEnv = process.env.NODE_ENV;
let dateNowSpy: jest.SpyInstance<number, []>;
let consoleLogSpy: jest.SpyInstance<void, [message?: unknown, ...optionalParams: unknown[]]>;
let agent: ReturnType<typeof request.agent>;

function advanceBase() {
  baseTime += WINDOW_MS * 2;
}

async function resetConfig() {
  await request(app)
    .patch("/api/v1/config")
    .send({
      rateLimitPerWindow: 60,
      rateLimitWindowMs: WINDOW_MS,
      bulkMaxItems: 100,
    });
}

function getRateLimitedHealth() {
  process.env.NODE_ENV = "development";
  return agent.get("/health");
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  await resetConfig();
  process.env.NODE_ENV = "development";
});

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  await resetConfig();
  agent = request.agent(app);
  advanceBase();
  process.env.NODE_ENV = "development";
  dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(baseTime);
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  dateNowSpy.mockRestore();
  consoleLogSpy.mockRestore();
  process.env.NODE_ENV = "test";
  await resetConfig();
});

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("rate limiter", () => {
  it("allows exactly 60 requests in one window", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await getRateLimitedHealth();
      expect(res.status).toBe(200);
    }
  });

  it("blocks the 61st request with 429 and rate_limited error", async () => {
    for (let i = 0; i < 60; i++) {
      await getRateLimitedHealth();
    }
    const res = await getRateLimitedHealth();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("rate_limited");
  });

  it("includes Retry-After: 60 on the 429 response", async () => {
    for (let i = 0; i < 60; i++) {
      await getRateLimitedHealth();
    }
    const res = await getRateLimitedHealth();
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
  });

  it("429 body has error and message fields", async () => {
    for (let i = 0; i < 60; i++) {
      await getRateLimitedHealth();
    }
    const res = await getRateLimitedHealth();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      error: "rate_limited",
      message: expect.stringContaining("60"),
    });
  });

  it("re-allows requests after the window expires", async () => {
    for (let i = 0; i < 60; i++) {
      await getRateLimitedHealth();
    }

    // Blocked inside the window
    let res = await getRateLimitedHealth();
    expect(res.status).toBe(429);

    // Advance time past the 60 s window
    dateNowSpy.mockReturnValue(baseTime + WINDOW_MS + 1);

    res = await getRateLimitedHealth();
    expect(res.status).toBe(200);
  });

  it("counts the 429 message body correctly", async () => {
    for (let i = 0; i < 60; i++) {
      await getRateLimitedHealth();
    }
    const res = await getRateLimitedHealth();
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/60.*requests.*60s/);
  });
});
