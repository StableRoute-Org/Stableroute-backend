/**
 * Express middleware for tenant and API-key scoped sliding-window rate limiting.
 *
 * Resolves request identity in order:
 * 1. API key from `Authorization: Bearer <key>` or `X-API-Key: <key>`
 * 2. Explicit tenant header `X-Tenant-ID: <id>`
 * 3. Client IP address fallback
 *
 * Sets standard headers on all responses:
 * - `X-RateLimit-Limit`
 * - `X-RateLimit-Remaining`
 * - `X-RateLimit-Reset`
 *
 * On rejection:
 * - HTTP 429
 * - `Retry-After: <seconds>`
 * - Structured `rate_limited` error payload
 *
 * @module rateLimit/middleware
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { apiKeyPrefix } from "../stores";
import { resolveClientIp } from "../utils/clientIp";
import { SlidingWindowRateLimiter } from "./slidingWindowLimiter";
import type { RateLimitResult } from "./types";

export interface RateLimitMiddlewareOptions {
  limiter?: SlidingWindowRateLimiter | undefined;
  resolveKey?: ((req: Request) => string) | undefined;
  /** Whether to bypass limiting when NODE_ENV === 'test'. Defaults to true. */
  skipInTest?: boolean | undefined;
  /** Optional callback when a request is rejected */
  onLimitReached?: ((req: Request, res: Response, result: RateLimitResult) => void) | undefined;
}

/**
 * Extract a stable tenant / API key / IP identifier for rate limiting.
 */
export function resolveRateLimitKey(req: Request): string {
  // 1. Authorization: Bearer <key>
  const authHeader = req.header("authorization") ?? "";
  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (bearerMatch?.[1]) {
    return `key:${apiKeyPrefix(bearerMatch[1])}`;
  }

  // 2. X-API-Key: <key>
  const apiKeyHeader = req.header("x-api-key");
  if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
    return `key:${apiKeyPrefix(apiKeyHeader.trim())}`;
  }

  // 3. X-Tenant-ID: <id>
  const tenantIdHeader = req.header("x-tenant-id");
  if (tenantIdHeader && tenantIdHeader.trim().length > 0) {
    return `tenant:${tenantIdHeader.trim()}`;
  }

  // 4. IP fallback
  const ip = resolveClientIp(
    req.headers["x-forwarded-for"],
    req.ip ?? req.socket.remoteAddress,
  );
  return `ip:${ip}`;
}

export function createRateLimitMiddleware(
  options: RateLimitMiddlewareOptions = {},
): RequestHandler {
  const limiter = options.limiter ?? new SlidingWindowRateLimiter();
  const keyResolver = options.resolveKey ?? resolveRateLimitKey;
  const skipInTest = options.skipInTest ?? true;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // In test environment, allow bypassing unless explicitly requested via test header
    const enforceInTest = req.header("x-test-enforce-ratelimit") === "true";
    if (process.env.NODE_ENV === "test" && skipInTest && !enforceInTest) {
      return next();
    }

    const key = keyResolver(req);
    const now = Date.now();
    const result = await limiter.consume(key, now);

    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    res.setHeader("X-RateLimit-Reset", String(result.resetTime));

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter));

      if (options.onLimitReached) {
        options.onLimitReached(req, res, result);
      }

      res.status(429).json({
        code: "rate_limited",
        error: "rate_limited",
        message: `rate limit exceeded: more than ${result.limit} requests per window. Try again in ${result.retryAfter}s`,
        retryAfter: result.retryAfter,
      });
      return;
    }

    next();
  };
}
