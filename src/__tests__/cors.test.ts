/**
 * CORS preflight smoke tests.
 *
 * The app mounts `cors()` before the pause guard (see `src/index.ts`), and
 * the pause guard explicitly passes `OPTIONS` through so browser preflights
 * keep working even when the service is paused.  These tests assert that
 * load-bearing guarantee so a regression would be caught immediately.
 *
 * @remarks
 * Helper: `sendPreflight(path)` issues an OPTIONS request with the standard
 * CORS preflight headers (`Origin` and `Access-Control-Request-Method`) so
 * individual test cases stay concise.
 */
import request from "supertest";
import app, { isCorsOriginAllowed, parseCorsAllowedOrigins } from "../index";
import { setPaused } from "../stores";

/**
 * Issue an OPTIONS preflight request to `path` with the required CORS
 * preflight headers.  Returns the supertest response.
 */
const sendPreflight = (path: string, origin = "http://localhost:3000") =>
  request(app)
    .options(path)
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "POST");

describe("CORS preflight smoke tests", () => {
  afterEach(() => {
    // Reset pause state so it cannot leak between tests.
    setPaused(false);
  });

  it("parses comma-separated CORS allowlist entries", () => {
    const allowed = parseCorsAllowedOrigins(
      " https://app.example.com,https://admin.example.com ,, ",
    );
    expect(allowed).toEqual(
      new Set(["https://app.example.com", "https://admin.example.com"]),
    );
  });

  it("allows configured origins and requests without Origin only", () => {
    const allowed = parseCorsAllowedOrigins("https://app.example.com");
    expect(isCorsOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isCorsOriginAllowed("https://evil.example", allowed)).toBe(false);
    expect(isCorsOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("OPTIONS preflight returns CORS headers for an allowed origin in normal operation", async () => {
    const res = await sendPreflight("/api/v1/pairs");

    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(res.headers["access-control-allow-methods"]).toBeTruthy();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();

    // 204 (Express cors default) or 200 are both acceptable — either way it
    // must not be a server error or a service_paused rejection.
    expect(res.status).toBeLessThan(400);
  });

  it("does not reflect disallowed origins", async () => {
    const res = await sendPreflight("/api/v1/pairs", "https://example.com");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("requests without an Origin header continue without CORS reflection", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("OPTIONS preflight succeeds while the service is paused (not blocked with 503)", async () => {
    setPaused(true);

    const res = await sendPreflight("/api/v1/pairs");

    // The pause guard must NOT block OPTIONS, so we must not see 503.
    expect(res.status).not.toBe(503);
    expect(res.status).toBeLessThan(400);

    // CORS headers must still be present — a missing header would break
    // browser clients just as much as a 503 would.
    expect(res.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
  });

  it("mutating POST is still blocked with 503 while paused (pause guard integrity)", async () => {
    setPaused(true);

    const res = await request(app)
      .post("/api/v1/pairs")
      .send({ source: "CORS", destination: "TEST" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("service_paused");
  });

  it("OPTIONS preflight to an unknown path does not return 503 while paused", async () => {
    setPaused(true);

    const res = await sendPreflight("/api/v1/nonexistent-resource");

    // Even for paths that have no explicit handler, OPTIONS must not be
    // blocked by the pause guard.
    expect(res.status).not.toBe(503);
  });
});
