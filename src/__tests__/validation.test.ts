import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { validateSchema } from "../middleware/validation";

function createMockReq(body: any): Request {
  return { body, path: "/test" } as unknown as Request;
}

function createMockRes() {
  const res: any = {
    status(code: number) { this._status = code; return this; },
    json(body: any) { this._body = body; return this; },
    _status: 200,
    _body: undefined,
  };
  return res as Response & { _status: number; _body: any };
}

describe("validateSchema", () => {
  it("passes valid input", () => {
    const schema = { name: { type: "string" as const, required: true } };
    const middleware = validateSchema(schema);
    const req = createMockReq({ name: "test" });
    const res = createMockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("rejects missing required field", () => {
    const schema = { name: { type: "string" as const, required: true } };
    const middleware = validateSchema(schema);
    const req = createMockReq({});
    const res = createMockRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(400);
  });

  it("rejects wrong type", () => {
    const schema = { age: { type: "number" as const } };
    const middleware = validateSchema(schema);
    const req = createMockReq({ age: "not-a-number" });
    const res = createMockRes();
    middleware(req, res, () => {});
    expect(res._status).toBe(400);
  });

  it("validates string length", () => {
    const schema = { code: { type: "string" as const, minLength: 1, maxLength: 12 } };
    const middleware = validateSchema(schema);
    const req = createMockReq({ code: "" });
    const res = createMockRes();
    middleware(req, res, () => {});
    expect(res._status).toBe(400);
  });

  it("validates number bounds", () => {
    const schema = { amount: { type: "number" as const, min: 0, max: 100 } };
    const middleware = validateSchema(schema);
    const req = createMockReq({ amount: 101 });
    const res = createMockRes();
    middleware(req, res, () => {});
    expect(res._status).toBe(400);
  });

  it("validates allowed values", () => {
    const schema = { status: { type: "string" as const, allowedValues: ["active", "inactive"] } };
    const middleware = validateSchema(schema);
    const req = createMockReq({ status: "unknown" });
    const res = createMockRes();
    middleware(req, res, () => {});
    expect(res._status).toBe(400);
  });
});
