import request from "supertest";
import app from "../index";

// Each test advances the clock by 120 s relative to the previous test's
// base so that bucket entries from prior tests are always outside the
// 60 s window and cannot bleed across tests.
const WINDOW_MS = 60_000;
let baseTime = Date.now();
const originalNodeEnv = process.env.NODE_ENV;
const originalTrustProxy = app.get("trust proxy");
let dateNowSpy: jest.SpyInstance<number, []>;
let consoleLogSpy: jest.SpyInstance;

const defaultRateLimitConfig = {
  rateLimitPerWindow: 60,
  rateLimitWindowMs: WINDOW_MS,
};

function advanceBase() {
  baseTime += WINDOW_MS * 2;
}

const rateLimitBuckets = () => app.locals.rateLimitBuckets as Map<string, number[]>;

const loadTrustProxySetting = (value: string | undefined) => {
  const previous = process.env.TRUST_PROXY;
  if (value === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = value;
  }

  let setting: unknown;
  jest.isolateModules(() => {
    setting = (require("../index").default as typeof app).get("trust proxy");
  });

  if (previous === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = previous;
  }
  return setting;
};

beforeAll(() => {
  process.env.NODE_ENV = "development";
});

beforeEach(() => {
  process.env.NODE_ENV = "development";
  app.set("trust proxy", false);
  rateLimitBuckets().clear();
  advanceBase();
  dateNowSpy = jest.spyOn(Date, "now").mockReturnValue(baseTime);
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  process.env.NODE_ENV = "test";
  await request(app)
    .patch("/api/v1/config")
    .send(defaultRateLimitConfig);
  rateLimitBuckets().clear();
  app.set("trust proxy", originalTrustProxy);
  dateNowSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

afterAll(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  app.set("trust proxy", originalTrustProxy);
});

describe("rate limiter", () => {
  it.each([
    [undefined, false],
    ["false", false],
    ["0", false],
    ["true", true],
    ["1", 1],
    ["loopback", "loopback"],
  ])("configures trust proxy from TRUST_PROXY=%s", (value, expected) => {
    expect(loadTrustProxySetting(value)).toBe(expected);
  });

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

  it("ignores spoofed X-Forwarded-For when proxy trust is disabled", async () => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app)
        .get("/health")
        .set("X-Forwarded-For", `198.51.100.${i}`);
      expect(res.status).toBe(200);
    }

    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "198.51.100.250");
    expect(res.status).toBe(429);
    expect(rateLimitBuckets().has("198.51.100.250")).toBe(false);
  });

  it("uses X-Forwarded-For client IPs only when proxy trust is enabled", async () => {
    app.set("trust proxy", 1);
    for (let i = 0; i < 60; i++) {
      const res = await request(app)
        .get("/health")
        .set("X-Forwarded-For", "198.51.100.1");
      expect(res.status).toBe(200);
    }

    const otherClient = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "198.51.100.2");
    expect(otherClient.status).toBe(200);

    const limitedClient = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "198.51.100.1");
    expect(limitedClient.status).toBe(429);
  });

  it("uses runtime config for the limit and window", async () => {
    app.set("trust proxy", 1);
    const update = await request(app)
      .patch("/api/v1/config")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ rateLimitPerWindow: 2, rateLimitWindowMs: 10_000 });
    expect(update.status).toBe(200);

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .get("/health")
        .set("X-Forwarded-For", "203.0.113.11");
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.11");
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("10");
    expect(limited.body.message).toMatch(/2.*requests.*10s/);
  });

  it("evicts expired buckets during lazy cleanup", async () => {
    app.set("trust proxy", 1);
    await request(app).get("/health").set("X-Forwarded-For", "198.51.100.1");
    await request(app).get("/health").set("X-Forwarded-For", "198.51.100.2");
    expect(rateLimitBuckets().size).toBe(2);

    dateNowSpy.mockReturnValue(baseTime + WINDOW_MS + 1);
    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "198.51.100.3");
    expect(res.status).toBe(200);
    expect([...rateLimitBuckets().keys()]).toEqual(["198.51.100.3"]);
  });
});
