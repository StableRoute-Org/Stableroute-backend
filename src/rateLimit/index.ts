/**
 * Tenant and API-key scoped sliding-window rate limiting.
 *
 * @module rateLimit
 */

export * from "./types";
export * from "./slidingWindowStore";
export * from "./slidingWindowLimiter";
export * from "./middleware";

import { SlidingWindowRateLimiter } from "./slidingWindowLimiter";
import { registerRateLimiterResetHook } from "../stores";

/** Global default sliding-window rate limiter instance */
export const defaultRateLimiter = new SlidingWindowRateLimiter();

registerRateLimiterResetHook(() => defaultRateLimiter.reset());

