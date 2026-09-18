/**
 * Express middleware providing concurrency-safe idempotency for financial swap operations.
 *
 * Enforces exactly-once execution semantics, atomic in-progress locking,
 * cross-tenant isolation, and replay caching.
 *
 * @module idempotency/middleware
 */

import type { Request, Response, NextFunction } from "express";
import { apiKeyPrefix } from "../stores";
import { computeFingerprint } from "./fingerprint";
import { idempotencyStore } from "./store";
import type { IdempotencyStore } from "./types";

export interface SwapIdempotencyOptions {
  store?: IdempotencyStore;
  ttlMs?: number;
}

/**
 * Resolve tenant/API key identifier from request headers.
 *
 * Order of precedence:
 * 1. Explicit `X-Tenant-Id` header (multi-tenant environments)
 * 2. `Authorization: Bearer <key>` header prefix
 * 3. `X-API-Key: <key>` header prefix
 * 4. Fallback to `"default"` tenant
 */
export const resolveTenantId = (req: Request): string => {
  const tenantHeader = req.header("x-tenant-id");
  if (tenantHeader && tenantHeader.trim().length > 0) {
    return tenantHeader.trim();
  }

  const auth = req.header("authorization") ?? "";
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(auth);
  if (bearerMatch && bearerMatch[1]) {
    return apiKeyPrefix(bearerMatch[1]);
  }

  const apiKeyHeader = req.header("x-api-key");
  if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
    return apiKeyPrefix(apiKeyHeader.trim());
  }

  return "default";
};

/**
 * Validate that an Idempotency-Key meets requirements:
 * - 1 to 200 characters in length
 * - Not purely whitespace
 * - Contains only printable ASCII characters (no control codes / CR / LF)
 */
export const isValidIdempotencyKey = (key: string): boolean => {
  if (typeof key !== "string") return false;
  if (key.length < 1 || key.length > 200) return false;
  if (key.trim().length === 0) return false;
  // Printable ASCII is 0x20 through 0x7E
  return /^[\x20-\x7E]+$/.test(key);
};

/**
 * Middleware factory for swap idempotency protection.
 */
export const createSwapIdempotencyMiddleware = (
  options: SwapIdempotencyOptions = {},
) => {
  const store = options.store ?? idempotencyStore;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const rawKey = req.header("idempotency-key");

    // Header absent -> behavior unchanged
    if (rawKey === undefined) {
      return next();
    }

    // Malformed / oversized key -> 400 invalid_request
    if (!isValidIdempotencyKey(rawKey)) {
      res.status(400).json({
        code: "invalid_request",
        error: "invalid_request",
        message:
          "Idempotency-Key header must be 1-200 non-empty printable characters",
        ...( (req as unknown as { id?: string }).id
          ? { requestId: (req as unknown as { id?: string }).id }
          : {}),
      });
      return;
    }

    const key = rawKey;
    const tenantId = resolveTenantId(req);
    const fingerprint = computeFingerprint(
      req.method,
      req.path,
      tenantId,
      req.body,
    );

    try {
      const lockResult = await store.acquire(
        key,
        tenantId,
        fingerprint,
        options.ttlMs,
      );

      if (lockResult.status === "conflict") {
        res.status(409).json({
          code: "idempotency_conflict",
          error: "idempotency_conflict",
          message: "Idempotency-Key reused with a different request body",
          ...( (req as unknown as { id?: string }).id
            ? { requestId: (req as unknown as { id?: string }).id }
            : {}),
        });
        return;
      }

      if (lockResult.status === "in_progress") {
        res.status(409).json({
          code: "request_in_progress",
          error: "request_in_progress",
          message:
            "A request with this idempotency key is currently in progress",
          ...( (req as unknown as { id?: string }).id
            ? { requestId: (req as unknown as { id?: string }).id }
            : {}),
        });
        return;
      }

      if (lockResult.status === "completed") {
        // Replay cached response verbatim without re-executing handler
        res.status(lockResult.statusCode).json(lockResult.responseBody);
        return;
      }

      // Lock acquired — intercept response completion
      let completed = false;
      const originalJson = res.json.bind(res);

      res.json = (body: unknown): Response => {
        completed = true;
        // Persist completed result
        void store.complete(key, tenantId, res.statusCode, body);
        return originalJson(body);
      };

      res.on("close", () => {
        if (!completed) {
          // Request aborted or failed with an unhandled server error
          void store.release(key, tenantId);
        }
      });

      next();
    } catch (err) {
      // In case of store error, release and propagate
      void store.release(key, tenantId);
      next(err);
    }
  };
};

/** Default middleware instance using global singleton store. */
export const swapIdempotencyMiddleware = createSwapIdempotencyMiddleware();
