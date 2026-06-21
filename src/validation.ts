import type { NextFunction, Request, Response } from "express";
import { z, type ZodType } from "zod";

type RequestSource = "body" | "query" | "params";
type RequestWithId = Request & { id?: string; validated?: unknown };

const assetCode = (message: string) =>
  z
    .unknown()
    .refine((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 12, message);

const integerString = (message: string) =>
  z.unknown().refine((value): value is string => typeof value === "string" && /^[0-9]{1,39}$/.test(value), message);

const positiveIntegerString = (message: string) =>
  z.unknown().refine((value): value is string => typeof value === "string" && /^[1-9][0-9]{0,38}$/.test(value), message);

/**
 * Query schema for the single-quote endpoint, preserving BigInt-safe amounts.
 */
export const quoteQuerySchema = z
  .object({
    source_asset: z.unknown().optional(),
    dest_asset: z.unknown().optional(),
    amount: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.source_asset || !value.dest_asset || !value.amount) {
      ctx.addIssue({
        code: "custom",
        message: "Missing required query params: source_asset, dest_asset, amount",
      });
      return;
    }

    const assetMessage = "source_asset and dest_asset must be 1-12 character strings";
    const source = assetCode(assetMessage).safeParse(value.source_asset);
    const destination = assetCode(assetMessage).safeParse(value.dest_asset);
    if (!source.success || !destination.success) {
      ctx.addIssue({ code: "custom", message: assetMessage });
      return;
    }
    if (source.data === destination.data) {
      ctx.addIssue({ code: "custom", message: "source_asset and dest_asset must differ" });
      return;
    }
    const amount = positiveIntegerString("amount must be a positive integer string with no leading zero").safeParse(value.amount);
    if (!amount.success) ctx.addIssue({ code: "custom", message: amount.error.issues[0].message });
  })
  .transform((value) => ({
    source_asset: value.source_asset as string,
    dest_asset: value.dest_asset as string,
    amount: value.amount as string,
  }));

/**
 * Body schema for registering a direct pair.
 */
export const pairBodySchema = z
  .object({
    source: assetCode("source and destination must be 1-12 character strings"),
    destination: assetCode("source and destination must be 1-12 character strings"),
  })
  .refine((value) => value.source !== value.destination, {
    message: "source and destination must differ",
  });

/**
 * Body schema for setting a pair fee in basis points.
 */
export const feeBpsPatchSchema = z.object({
  feeBps: z
    .unknown()
    .refine((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000, {
      message: "feeBps must be an integer in [0,1000]",
    }),
});

/**
 * Body schema for setting pair minimum amount.
 */
export const minAmountPatchSchema = z.object({
  minAmount: integerString("minAmount must be a non-negative integer string"),
});

/**
 * Body schema for setting pair maximum amount.
 */
export const maxAmountPatchSchema = z.object({
  maxAmount: positiveIntegerString("maxAmount must be a positive integer string"),
});

/**
 * Body schema for setting pair liquidity.
 */
export const liquidityPatchSchema = z.object({
  liquidity: integerString("liquidity must be a non-negative integer string"),
});

/**
 * Body schema for bulk quote requests; item validation stays per-item.
 */
export const bulkQuoteBodySchema = z.object({
  items: z
    .unknown()
    .refine((value): value is unknown[] => Array.isArray(value) && value.length > 0 && value.length <= 100, {
      message: "items must be 1-100 entries",
    }),
});

/**
 * Body schema for webhook registration.
 */
export const webhookBodySchema = z.object({
  url: z
    .unknown()
    .refine((value): value is string => typeof value === "string" && /^https?:\/\//.test(value) && value.length <= 2048, {
      message: "url must be http(s), <=2048 chars",
    }),
  events: z
    .unknown()
    .refine((value): value is string[] => Array.isArray(value) && value.length > 0 && value.every((event) => typeof event === "string"), {
      message: "events must be a non-empty string array",
    }),
});

/**
 * Body schema for creating an API key.
 */
export const apiKeyBodySchema = z.object({
  label: z
    .unknown()
    .refine((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 64, {
      message: "label must be 1-64 chars",
    }),
});

/**
 * Body schema for patching runtime config.
 */
export const configPatchSchema = z
  .object({
    rateLimitPerWindow: z.unknown().optional(),
    rateLimitWindowMs: z.unknown().optional(),
    bulkMaxItems: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    for (const key of ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems"] as const) {
      if (key in value) {
        const candidate = value[key];
        if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate <= 0) {
          ctx.addIssue({ code: "custom", message: `${key} must be positive integer` });
          return;
        }
      }
    }
  })
  .transform((value) => value as Partial<Record<"rateLimitPerWindow" | "rateLimitWindowMs" | "bulkMaxItems", number>>);

/**
 * Express middleware that stores parsed data on req.validated or emits the canonical 400 body.
 */
export const validate =
  <T>(schema: ZodType<T>, source: RequestSource) =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "invalid request";
      res.status(400).json({
        error: "invalid_request",
        message,
        requestId: (req as RequestWithId).id,
      });
      return;
    }
    (req as RequestWithId).validated = parsed.data;
    next();
  };

export const getValidated = <T>(req: Request): T => (req as RequestWithId).validated as T;
