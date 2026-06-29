import request from "supertest";
import app from "../index";
import { version as pkgVersion, name as pkgName } from "../../package.json";

describe("GET /api/v1/version", () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("returns build metadata with version matching package.json", async () => {
    const res = await request(app).get("/api/v1/version");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(pkgName);
    expect(res.body.version).toBe(pkgVersion);
    expect(res.body.node).toBe(process.version);
  });

  it("surfaces GIT_COMMIT and BUILD_TIME when set", async () => {
    process.env.GIT_COMMIT = "abc1234";
    process.env.BUILD_TIME = "2026-01-01T00:00:00Z";
    const res = await request(app).get("/api/v1/version");
    expect(res.status).toBe(200);
    expect(res.body.commit).toBe("abc1234");
    expect(res.body.buildTime).toBe("2026-01-01T00:00:00Z");
  });

  it("falls back to 'unknown' when env vars are unset", async () => {
    delete process.env.GIT_COMMIT;
    delete process.env.BUILD_TIME;
    const res = await request(app).get("/api/v1/version");
    expect(res.status).toBe(200);
    expect(res.body.commit).toBe("unknown");
    expect(res.body.buildTime).toBe("unknown");
  });
});
