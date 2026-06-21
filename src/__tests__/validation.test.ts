import type { NextFunction, Request, Response } from "express";
import {
  apiKeyBodySchema,
  configPatchSchema,
  getValidated,
  pairBodySchema,
  quoteQuerySchema,
  validate,
  webhookBodySchema,
} from "../validation";

describe("validation schemas", () => {
  it("rejects array-form quote params before route logic", () => {
    const parsed = quoteQuerySchema.safeParse({
      source_asset: ["USDC", "EURC"],
      dest_asset: "XLM",
      amount: "10",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/1-12 character strings/);
    }
  });

  it("preserves BigInt-safe quote amount strings", () => {
    const amount = "10000000000000000000000000";
    const parsed = quoteQuerySchema.parse({
      source_asset: "USDC",
      dest_asset: "EURC",
      amount,
    });
    expect(parsed.amount).toBe(amount);
  });

  it("rejects same pair assets", () => {
    const parsed = pairBodySchema.safeParse({ source: "USDC", destination: "USDC" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/must differ/);
    }
  });

  it("rejects invalid webhook and config bodies", () => {
    expect(webhookBodySchema.safeParse({ url: "ftp://x", events: ["pair.registered"] }).success).toBe(false);
    expect(configPatchSchema.safeParse({ rateLimitPerWindow: -1 }).success).toBe(false);
  });

  it("stores validated data or emits the canonical 400 response", () => {
    const okReq = { body: { label: "ops" }, id: "req-ok" } as Request & { id: string };
    const okRes = {} as Response;
    const okNext = jest.fn() as NextFunction;

    validate(apiKeyBodySchema, "body")(okReq, okRes, okNext);
    expect(okNext).toHaveBeenCalled();
    expect(getValidated<{ label: string }>(okReq).label).toBe("ops");

    const badReq = { body: { label: "" }, id: "req-bad" } as Request & { id: string };
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const badRes = { status } as unknown as Response;
    const badNext = jest.fn() as NextFunction;

    validate(apiKeyBodySchema, "body")(badReq, badRes, badNext);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: "invalid_request",
      message: "label must be 1-64 chars",
      requestId: "req-bad",
    });
    expect(badNext).not.toHaveBeenCalled();
  });
});
