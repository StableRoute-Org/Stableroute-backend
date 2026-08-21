import request from "supertest";
import express, { type NextFunction, type Request } from "express";
import app, {
  API_ERROR_DEFINITIONS,
  ApiError,
  apiErrorHandler,
} from "../index";

const oversizedJson = JSON.stringify({ payload: "x".repeat(101 * 1024) });

describe("API error taxonomy unit coverage", () => {
  it("maps each stable code to exactly one HTTP status", () => {
    expect(API_ERROR_DEFINITIONS.invalid_request.status).toBe(400);
    expect(API_ERROR_DEFINITIONS.not_found.status).toBe(404);
    expect(API_ERROR_DEFINITIONS.conflict.status).toBe(409);
    expect(API_ERROR_DEFINITIONS.internal_error.status).toBe(500);
  });

  it("formats domain errors through the centralized middleware", async () => {
    const testApp = express();
    testApp.use((req: Request, _res, next: NextFunction) => {
      (req as Request & { id?: string }).id = "unit-request-id";
      next();
    });
    testApp.get("/unit", (_req, _res, next) => {
      next(new ApiError("conflict", "unit conflict", { field: "version" }));
    });
    testApp.use(apiErrorHandler);

    const res = await request(testApp).get("/unit");

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "conflict",
      error: "conflict",
      message: "unit conflict",
      field: "version",
      requestId: "unit-request-id",
    });
  });
});

describe("Centralized API error middleware integration", () => {
  it("returns a consistent 400 validation shape", async () => {
    const res = await request(app)
      .get("/test/domain-validation")
      .set("X-Request-Id", "validation-request-id");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "invalid_request",
      error: "invalid_request",
      message: "amount must be a positive number",
      field: "amount",
      requestId: "validation-request-id",
    });
  });

  it("returns a consistent 404 not-found shape", async () => {
    const res = await request(app)
      .get("/api/v1/not-real")
      .set("X-Request-Id", "not-found-request-id");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: "not_found",
      error: "not_found",
      message: "No route for GET /api/v1/not-real",
      requestId: "not-found-request-id",
    });
  });

  it("returns a consistent 409 conflict shape", async () => {
    const res = await request(app)
      .get("/test/domain-conflict")
      .set("X-Request-Id", "conflict-request-id");

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "conflict",
      error: "conflict",
      message: "resource version conflict",
      requestId: "conflict-request-id",
    });
  });

  it("returns 413 for oversized JSON without leaking parser internals", async () => {
    const res = await request(app)
      .post("/api/v1/pairs")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "too-large-request-id")
      .send(oversizedJson);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      code: "payload_too_large",
      error: "payload_too_large",
      message: "request body exceeds the 100 KiB limit",
      requestId: "too-large-request-id",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\s+\(/);
    expect(res.body.stack).toBeUndefined();
  });

  it("returns 400 for malformed JSON without echoing raw parser text", async () => {
    const res = await request(app)
      .post("/api/v1/pairs")
      .set("Content-Type", "application/json")
      .set("X-Request-Id", "bad-json-request-id")
      .send("{bad");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "invalid_json",
      error: "invalid_json",
      message: "request body is not valid JSON",
      requestId: "bad-json-request-id",
    });
    expect(JSON.stringify(res.body)).not.toContain("{bad");
  });

  it("returns 500 for unexpected errors without leaking details", async () => {
    const res = await request(app)
      .get("/test/unexpected-error")
      .set("X-Request-Id", "unexpected-request-id");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      code: "internal_error",
      error: "internal_error",
      message: "An unexpected error occurred",
      method: "GET",
      path: "/test/unexpected-error",
      requestId: "unexpected-request-id",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret connection string");
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\w+\s+\(/);
    expect(res.body.stack).toBeUndefined();
  });

  it.each([
    ["validation", () => request(app).get("/test/domain-validation")],
    ["not-found", () => request(app).get("/missing-route")],
    ["conflict", () => request(app).get("/test/domain-conflict")],
    ["unexpected", () => request(app).get("/test/unexpected-error")],
    [
      "invalid-json",
      () =>
        request(app)
          .post("/api/v1/pairs")
          .set("Content-Type", "application/json")
          .send("{"),
    ],
    [
      "payload-too-large",
      () =>
        request(app)
          .post("/api/v1/pairs")
          .set("Content-Type", "application/json")
          .send(oversizedJson),
    ],
  ])("carries a requestId for %s errors", async (_name, makeRequest) => {
    const res = await makeRequest().set("X-Request-Id", "shared-error-id");
    expect(res.body.requestId).toBe("shared-error-id");
  });
});
