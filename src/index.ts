import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { logger } from "./logger";
import { openApiSpec } from "./openapi";
import { isSafeWebhookUrl } from "./utils/webhookUrl";
import { resolveClientIp } from "./utils/clientIp";
import { getStoreAdapter } from "./persistence";
import {
  isPaused,
  isReadOnly,
  pairRegistry,
  pairMeta,
  apiKeyStore,
  webhookStore,
  eventLog,
  rateBuckets,
  config,
  setPaused,
  setReadOnly,
  pairKey,
  defaultMeta,
  recordEvent,
  trimEventLog,
  EVENT_LOG_CAP,
  EVENT_LOG_CAP_MAX,
  RATE_BUCKETS_MAX_IPS,
  HEALTH_PROBE_KEY,
  KNOWN_EVENT_TYPES,
  hydrateFromSnapshot,
  setHydrating,
  apiKeyPrefix,
  generateApiKeySalt,
  hashApiKeySecret,
  verifyApiKeySecret,
  type PairMeta,
  type AppEvent,
  type ApiKeyRecord,
  type EventType,
} from "./stores";
import { checkQuoteBounds, priceQuote, priceReverseQuote } from "./pricing";

/** Maximum number of event-type entries per webhook subscription. */
const WEBHOOK_MAX_EVENTS = 20;

/** Maximum length of a single event-type name string. */
const WEBHOOK_MAX_EVENT_LENGTH = 128;

/** Event name prefixes reserved for internal use. */
const WEBHOOK_RESERVED_PREFIXES = ["internal.", "system.", "admin."];

/** Absolute ceiling for bulk item counts — operators cannot raise beyond this. */
const BULK_ABSOLUTE_MAX = 10_000;


const app = express();

// --- Persistence Hydration on startup ---
export const hydrationPromise = (async () => {
  try {
    const adapter = getStoreAdapter();
    setHydrating(true);
    const snapshot = await adapter.load();
    if (snapshot) {
      hydrateFromSnapshot(snapshot);
      logger.info("[persistence] hydrated stores successfully from adapter");
    } else {
      logger.info("[persistence] no snapshot found or hydration skipped");
    }
  } catch (err) {
    logger.error({ err }, "[persistence] hydration failed");
  } finally {
    setHydrating(false);
  }
})();





const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

/** Parse a comma-separated CORS origin allowlist, falling back to localhost-only development origins. */
export const parseCorsAllowedOrigins = (value: string | undefined): Set<string> => {
  const source = value === undefined || value.trim() === "" ? DEFAULT_CORS_ALLOWED_ORIGINS.join(",") : value;
  return new Set(source.split(",").map((origin) => origin.trim()).filter(Boolean));
};

/**
 * Resolve whether an inbound Origin is allowed.
 *
 * Requests without an Origin header are same-origin/server-to-server traffic and
 * are passed through without reflecting arbitrary browser origins.
 */
export const isCorsOriginAllowed = (
  origin: string | undefined,
  allowedOrigins: Set<string>
): boolean => origin === undefined || allowedOrigins.has(origin);

const corsAllowedOrigins = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

app.use(cors({
  credentials: false,
  origin: (origin, callback) => {
    callback(null, isCorsOriginAllowed(origin, corsAllowedOrigins));
  },
}));

type RequestWithId = Request & { id?: string };
type ErrorResponseExtra = Record<string, unknown>;

/** Union of all error codes used in API responses. */
export type ApiErrorCode =
  | "not_found"
  | "invalid_request"
  | "invalid_json"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "service_paused"
  | "internal_error"
  | "not_acceptable"
  | "payload_too_large"
  | "conflict"
  | "method_not_allowed"
  | "read_only_mode"
  | "pair_not_registered"
  | "idempotency_conflict"
  | "unsupported_media_type"
  | "insufficient_liquidity";

/**
 * Validates an inbound X-Request-Id value.
 *
 * Accepted format: 1–200 characters drawn exclusively from the conservative
 * token charset `[A-Za-z0-9._-]`. This deliberately excludes control
 * characters, CR, LF, and other non-token bytes that could be used for
 * header-injection or log-injection attacks.
 *
 * @param value - The raw header value to validate.
 * @returns `true` when the value is safe to echo; `false` otherwise.
 */
export const isValidRequestId = (value: string): boolean =>
  value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._-]+$/.test(value);

/**
 * Read the request id attached by the correlation middleware.
 */
const getRequestId = (req: Request): string | undefined => (req as RequestWithId).id;

/**
 * Send the canonical API error body used by explicit handlers and middleware.
 */
const sendError = (
  res: Response,
  req: Request,
  status: number,
  error: ApiErrorCode,
  message: string,
  extra: ErrorResponseExtra = {}
) => res.status(status).json({ error, message, ...extra, requestId: getRequestId(req) });

/**
 * Helper to retrieve the current idempotency TTL in milliseconds.
 * Always resolves dynamically from `process.env.IDEMPOTENCY_TTL_MS`
 * to allow test overrides, falling back to 24 hours.
 */
const getIdempotencyTtlMs = (): number =>
  Number(process.env.IDEMPOTENCY_TTL_MS ?? 24 * 60 * 60 * 1000);

/**
 * Helper to retrieve the maximum number of entries kept in the idempotency cache.
 * Always resolves dynamically from `process.env.IDEMPOTENCY_CACHE_MAX`
 * to allow test overrides, falling back to 10,000.
 */
const getIdempotencyCacheMax = (): number =>
  Number(process.env.IDEMPOTENCY_CACHE_MAX ?? 10_000);

interface IdempotencyCacheEntry {
  status: number;
  body: unknown;
  bodyHash: string;
  expiresAt: number;
}

/**
 * In-memory idempotency cache keyed by `"METHOD:path:idempotency-key"`.
 * Entries are TTL-expiring and the map is bounded to IDEMPOTENCY_CACHE_MAX
 * entries (oldest-first eviction).
 */
const idempotencyCache = new Map<string, IdempotencyCacheEntry>();

/**
 * Clear the internal idempotency cache.
 * Exposes the store for test isolation to prevent cross-test state bleed.
 */
export const clearIdempotencyCache = (): void => {
  idempotencyCache.clear();
};

/**
 * Evict all expired entries. When the cache is still at capacity after
 * expiry-based eviction, drop the oldest insertion-order entry.
 */
const pruneIdempotencyCache = (): void => {
  const now = Date.now();
  for (const [k, entry] of idempotencyCache) {
    if (entry.expiresAt <= now) idempotencyCache.delete(k);
  }
  if (idempotencyCache.size >= getIdempotencyCacheMax()) {
    const oldest = idempotencyCache.keys().next().value;
    if (oldest !== undefined) idempotencyCache.delete(oldest);
  }
};

/**
 * Express middleware that implements Idempotency-Key semantics for create
 * (POST) endpoints.
 *
 * @param req - Express Request object
 * @param res - Express Response object
 * @param next - Express NextFunction
 *
 * @remarks
 * Behaviour:
 * - No Idempotency-Key header: passes through unchanged.
 * - Key present but outside 1-200 chars: passes through unchanged.
 * - First request with a key: executes the handler, captures the response,
 *   and stores `{ status, body, bodyHash, expiresAt }` in the cache.
 * - Repeat request with matching key + matching body hash: replays cached
 *   response verbatim (no handler invocation).
 * - Repeat request with matching key but different body: 409 idempotency_conflict.
 *
 * Cache entries expire after dynamic TTL (default 24 h).
 */
const idempotencyGuard = (req: Request, res: Response, next: NextFunction): void => {
  const idempotencyKey = req.header("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    return next();
  }

  const cacheKey = `${req.method}:${req.path}:${idempotencyKey}`;
  const bodyHash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");

  const existing = idempotencyCache.get(cacheKey);
  if (existing) {
    if (existing.expiresAt > Date.now()) {
      if (existing.bodyHash !== bodyHash) {
        sendError(res, req, 409, "idempotency_conflict", "Idempotency-Key reused with a different request body");
        return;
      }
      // Replay cached response verbatim.
      res.status(existing.status).json(existing.body);
      return;
    }
    // Expired entry - remove it and fall through to execute the handler.
    idempotencyCache.delete(cacheKey);
  }

  // Wrap res.json to capture the response before it is sent.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown): Response => {
    pruneIdempotencyCache();
    idempotencyCache.set(cacheKey, {
      status: res.statusCode,
      body,
      bodyHash,
      expiresAt: Date.now() + getIdempotencyTtlMs(),
    });
    return originalJson(body);
  };

  next();
};

/**
 * Strict body-key guard.
 *
 * Enforces that a JSON request body contains only keys from `allowed`. When the
 * body carries any extra top-level key, a `400 invalid_request` is sent listing
 * the offending keys (with the canonical `requestId`) and the function returns
 * `true` so the caller can `return` immediately.
 *
 * An absent or non-object body is treated as having no keys to reject. Own
 * enumerable keys are read via `Object.keys`, so inherited / prototype-pollution
 * keys like `__proto__` (which arrive as own enumerable keys when present in the
 * raw JSON) are surfaced as unknown rather than silently honoured.
 *
 * @param req     - The incoming request (used for the body and request id).
 * @param res     - The response used to emit the canonical error.
 * @param allowed - The exhaustive set of permitted top-level body keys.
 * @returns `true` when an error was sent (unknown keys present), else `false`.
 */
const rejectUnknownKeys = (req: Request, res: Response, allowed: string[]): boolean => {
  const body = req.body;
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const allow = new Set(allowed);
  const unknown = Object.keys(body).filter((k) => !allow.has(k));
  if (unknown.length > 0) {
    sendError(res, req, 400, "invalid_request", `unknown field(s): ${unknown.join(", ")}`, {
      unknownKeys: unknown,
    });
    return true;
  }
  return false;
};

/**
 * Correlation middleware.
 *
 * Attaches a sanitized `X-Request-Id` to the request (`req.id`) and sets the `X-Request-Id` response header.
 * If the client provides an `X-Request-Id` header:
 * - It is echoed verbatim if it matches a strict pattern: 1-200 characters from `[A-Za-z0-9._-]`.
 * - If it contains control characters, CRLF, spaces, or is over-length, it is silently replaced with a fresh UUID v4 to prevent header splitting and log injection.
 * - If no header is provided, a fresh UUID v4 is generated.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("x-request-id");
  const id = incoming !== undefined && isValidRequestId(incoming) ? incoming : randomUUID();
  (req as RequestWithId).id = id;
  res.setHeader("X-Request-Id", id);
  next();
});

app.use(express.json({ limit: "100kb" }));

/**
 * Content-Type guard for body-bearing HTTP methods.
 *
 * Mutating requests (`POST`, `PATCH`, `PUT`) that include a payload **must**
 * declare `Content-Type: application/json` (the `charset` parameter is
 * permitted, e.g. `application/json; charset=utf-8`). Any other media type —
 * or an absent `Content-Type` — is rejected immediately with
 * `415 unsupported_media_type` and the canonical `{ error, message, requestId }`
 * body.
 *
 * @remarks
 * **Placement rationale** — this middleware is registered *after*
 * `express.json({ limit: "100kb" })` intentionally:
 * 1. `express.json()` runs first. A request that declares
 *    `Content-Type: application/json` but exceeds the 100 kB limit is
 *    rejected by the body parser **before** this guard even fires, so a
 *    forged content-type cannot be used to smuggle an oversized body into
 *    a route handler.
 * 2. `express.json()` only parses bodies whose declared type is JSON; it
 *    leaves `req.body` undefined for any other type. This guard then
 *    catches those cases and returns a human-readable 415 instead of
 *    allowing the missing `req.body` to fall through to handler-level
 *    validation and produce a confusing 400.
 *
 * **Skipped for safe methods and empty bodies** — `GET`, `HEAD`, `DELETE`,
 * and `OPTIONS` are passed through unconditionally. For body-bearing methods,
 * the check is skipped when both `Content-Length` is absent (or zero) *and*
 * `Transfer-Encoding` is absent, because there is no payload to validate.
 *
 * @param req  - Incoming Express request.
 * @param res  - Outgoing Express response.
 * @param next - Express next-function; called when the request may proceed.
 */
export const requireJsonContentType = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "DELETE" || method === "OPTIONS") {
    next();
    return;
  }
  const hasBody =
    (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0") ||
    req.headers["transfer-encoding"] !== undefined;
  if (!hasBody) {
    next();
    return;
  }
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    next();
    return;
  }
  sendError(
    res,
    req,
    415,
    "unsupported_media_type",
    "Content-Type must be application/json"
  );
};

app.use(requireJsonContentType);

// Pause guard: refuses non-idempotent methods with 503 except
// /admin/unpause, so an operator can always recover.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isPaused()) return next();
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  if (req.path === "/api/v1/admin/unpause") return next();
  sendError(res, req, 503, "service_paused", "StableRoute backend is paused");
});

/**
 * Read-only maintenance guard.
 *
 * When `readOnly` is enabled (and the service is not paused — `paused` is
 * strictly stronger and its guard runs first), this middleware keeps reads and
 * quotes flowing while rejecting other mutating writes with
 * `503 read_only_mode`.
 *
 * Allowed while read-only:
 * - idempotent methods `GET` / `HEAD` / `OPTIONS`;
 * - the quote endpoints (`/api/v1/quote`, `/api/v1/quote/reverse`,
 *   `/api/v1/quote/bulk`), including the POST bulk-quote;
 * - `POST /api/v1/admin/read-write`, so an operator can always recover
 *   (mirroring the unpause carve-out).
 *
 * All other mutating requests receive the canonical `503 read_only_mode` body.
 */
const QUOTE_PATHS = new Set([
  "/api/v1/quote",
  "/api/v1/quote/reverse",
  "/api/v1/quote/bulk",
]);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!isReadOnly()) return next();
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  if (QUOTE_PATHS.has(req.path)) return next();
  // Recovery path must always be reachable, like /admin/unpause.
  if (req.path === "/api/v1/admin/read-write") return next();
  sendError(res, req, 503, "read_only_mode", "StableRoute backend is in read-only mode");
});

// Per-IP sliding-window rate limiter.
// Reads config.rateLimitPerWindow and config.rateLimitWindowMs at request time
// so PATCH /api/v1/config changes take effect immediately.
// Disabled in test mode so the test suite can make many requests without hitting the limit.
const RATE_LIMIT_WINDOW_MS = 60_000;

export type TrustProxySetting = boolean | number | string | string[];

/** Parse a trust proxy setting string from the environment. */
export const parseTrustProxy = (value: string | undefined): TrustProxySetting => {
  if (value === undefined || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  const numeric = Number(normalized);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  if (value.includes(",")) {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return value.trim();
};

app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

let lastRateBucketGcAt = 0;
const RATE_BUCKET_GC_INTERVAL_MS = 60_000;

/** Prune IP rate limit buckets that have not had any requests within the window. */
export const pruneExpiredRateBuckets = (now: number, windowMs: number): number => {
  if (now - lastRateBucketGcAt < RATE_BUCKET_GC_INTERVAL_MS) return 0;
  lastRateBucketGcAt = now;
  let removed = 0;
  for (const [ip, bucket] of rateBuckets) {
    const live = bucket.filter((t) => now - t < windowMs);
    if (live.length === 0) {
      rateBuckets.delete(ip);
      removed++;
    } else if (live.length !== bucket.length) {
      rateBuckets.set(ip, live);
    }
  }
  return removed;
};

/**
 * Evict stale timestamps from the rate-bucket for `ip` and return the live
 * (within-window) entries.
 *
 * Side effects:
 * - Removes the map entry for `ip` when all its timestamps are stale.
 * - Enforces the IP-count ceiling: when the map holds
 *   {@link RATE_BUCKETS_MAX_IPS} entries and a new IP is admitted, the
 *   oldest entry is deleted first so cardinality never exceeds the cap.
 */
export const evictRateBuckets = (ip: string, now: number, windowMs: number): number[] => {
  // Enforce IP-count ceiling for new IPs.
  if (!rateBuckets.has(ip) && rateBuckets.size >= RATE_BUCKETS_MAX_IPS) {
    const oldestKey = rateBuckets.keys().next().value as string;
    rateBuckets.delete(oldestKey);
  }
  const existing = rateBuckets.get(ip) ?? [];
  const live = existing.filter((t) => now - t < windowMs);
  // Delete empty buckets to keep memory bounded and avoid stale map entries.
  if (existing.length > 0 && live.length === 0) {
    rateBuckets.delete(ip);
  }
  return live;
};

app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "test") return next();
  const ip = resolveClientIp(req.headers["x-forwarded-for"], req.ip ?? req.socket.remoteAddress);
  const now = Date.now();
  const windowMs = config.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;
  pruneExpiredRateBuckets(now, windowMs);
  const limitPerWindow = config.rateLimitPerWindow ?? 60;
  const bucket = evictRateBuckets(ip, now, windowMs);
  if (bucket.length >= limitPerWindow) {
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    sendError(
      res,
      req,
      429,
      "rate_limited",
      `more than ${limitPerWindow} requests per ${windowMs / 1000}s`
    );
    return;
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  next();
});

// Request timing — emits a single structured log per finished request
// and sets Server-Timing.
app.use((req: Request, res: Response, next: NextFunction) => {
  const startNs = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    logger
      .child({
        requestId: getRequestId(req),
        method: req.method,
        path: req.path,
      })
      .info(
        {
          status: res.statusCode,
          durationMs: Math.round(ms * 10) / 10,
        },
        "request completed"
      );
  });
  next();
});

app.use(
  helmet({
    // This API only returns JSON/text, so the tightest useful CSP is no ambient sources.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: { policy: "require-corp" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    xFrameOptions: { action: "deny" },
  })
);

/**
 * Paths that are exempt from the JSON content-negotiation guard.
 *
 * - `GET /health` — shallow liveness probe (must never require Accept headers).
 * - `GET /api/v1/metrics` — Prometheus scrape endpoint that serves `text/plain`.
 *
 * Both must remain reachable by monitoring systems that send no Accept header
 * or that explicitly request `text/plain`.
 */
const ACCEPT_NEGOTIATION_EXEMPT = new Set(["/health", "/api/v1/metrics"]);

/**
 * JSON content-negotiation guard.
 *
 * Rejects requests whose `Accept` header is present and explicitly excludes
 * `application/json` (and wildcards `*\/\*` / `application/*`) with a
 * `406 Not Acceptable` response using the canonical `sendError` envelope.
 *
 * Rules:
 * - A missing `Accept` header is treated as acceptable (defaults to JSON).
 * - `*\/*` and `application/*` wildcards are accepted.
 * - Routes in `ACCEPT_NEGOTIATION_EXEMPT` are always passed through.
 *
 * Security note: only the Accept header value is examined; the guard does not
 * re-evaluate pause or rate-limit state, so those middleware layers remain
 * authoritative for their own concerns.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (ACCEPT_NEGOTIATION_EXEMPT.has(req.path)) return next();

  const accept = req.header("accept");
  if (!accept) return next();

  // Split on comma to get individual media-range tokens; strip quality params.
  const types = accept.split(",").map((t) => t.split(";")[0].trim().toLowerCase());

  const acceptable = types.some(
    (t) => t === "*/*" || t === "application/json" || t === "application/*"
  );

  if (!acceptable) {
    sendError(res, req, 406, "not_acceptable", "This endpoint only produces application/json");
    return;
  }

  next();
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "stableroute-backend" });
});

app.get("/api/v1/openapi.json", (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

/**
 * Run all health checks for the deep readiness probe.
 * Each check measures its own duration (in milliseconds) and returns
 * `{ name, status, durationMs }`. Checks are synchronous and fast so
 * the probe never hangs. External dependencies (e.g. storage, clock)
 * are tested with a lightweight read/write cycle respectively.
 *
 * Results are returned as an array of { name, status, durationMs } objects.
 */
const runHealthChecks = (): Array<{ name: string; status: "ok" | "fail"; durationMs: number }> => {
  const checks: Array<{ name: string; status: "ok" | "fail"; durationMs: number }> = [];

  // Storage check — verifies that the in-memory store can write and read back.
  // Uses the reserved HEALTH_PROBE_KEY sentinel (prefixed with a NUL control
  // character) so the scratch entry can never collide with a real pair key.
  const storageStart = Date.now();
  try {
    const testKey = HEALTH_PROBE_KEY;
    pairMeta.set(testKey, defaultMeta());
    const readback = pairMeta.get(testKey);
    pairMeta.delete(testKey);
    checks.push({
      name: "storage",
      status: readback !== undefined ? "ok" : "fail",
      durationMs: Date.now() - storageStart,
    });
  } catch {
    checks.push({
      name: "storage",
      status: "fail",
      durationMs: Date.now() - storageStart,
    });
  }

  // Clock check — verifies the system clock is producing post-epoch timestamps.
  const clockStart = Date.now();
  try {
    const now = Date.now();
    // A timestamp earlier than 2020-01-01 indicates a broken system clock.
    checks.push({
      name: "clock",
      status: now > 1577836800000 ? "ok" : "fail",
      durationMs: Date.now() - clockStart,
    });
  } catch {
    checks.push({
      name: "clock",
      status: "fail",
      durationMs: Date.now() - clockStart,
    });
  }

  return checks;
};

app.get("/api/v1/health/deep", (req: Request, res: Response) => {
  const m = process.memoryUsage();

  // Checks are synchronous and fast so the probe never hangs.
  // When async downstream checks are added, wrap runHealthChecks() in a
  // Promise.race with a timeout or pass an AbortSignal.
  const checks = runHealthChecks();
  const degraded = checks.some((c) => c.status === "fail");
  const status = isPaused() ? "paused" : degraded ? "degraded" : "ok";

  const body = {
    status,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round(m.rss / 1024 / 1024),
      heapUsedMb: Math.round(m.heapUsed / 1024 / 1024),
    },
    pid: process.pid,
    node: process.version,
    checks,
  };

  if (degraded) {
    res.status(503).json(body);
  } else {
    res.json(body);
  }
});
/**
 * Build/identity metadata read once at module load.
 *
 * `name` and `version` come from `package.json` (resolved at runtime so the
 * value is never hard-coded), while `commit` and `buildTime` are injected by
 * the deploy pipeline through the `GIT_COMMIT` / `BUILD_TIME` env vars. Any
 * missing env var degrades gracefully to `"unknown"` rather than throwing.
 */
const pkg = createRequire(__filename)("../package.json") as {
  name?: string;
  version?: string;
};

/**
 * GET /api/v1/version — lightweight build/version metadata.
 *
 * Unauthenticated and cheap: runs no health checks and exposes only build
 * identity (`name`, `version`, `commit`, `buildTime`, `node`) — never secrets,
 * paths, or internal config. Missing `GIT_COMMIT` / `BUILD_TIME` env vars fall
 * back to `"unknown"`.
 */
app.get("/api/v1/version", (_req: Request, res: Response) => {
  res.json({
    name: pkg.name ?? "unknown",
    version: pkg.version ?? "unknown",
    commit: process.env.GIT_COMMIT ?? "unknown",
    buildTime: process.env.BUILD_TIME ?? "unknown",
    node: process.version,
  });
});

app.post("/api/v1/admin/pause", (_req: Request, res: Response) => {
  setPaused(true);
  recordEvent("admin.paused", {});
  res.json({ paused: isPaused() });
});
app.post("/api/v1/admin/unpause", (_req: Request, res: Response) => {
  setPaused(false);
  recordEvent("admin.unpaused", {});
  res.json({ paused: isPaused() });
});
app.post("/api/v1/admin/read-only", (_req: Request, res: Response) => {
  setReadOnly(true);
  res.json({ readOnly: isReadOnly() });
});
app.post("/api/v1/admin/read-write", (_req: Request, res: Response) => {
  setReadOnly(false);
  res.json({ readOnly: isReadOnly() });
});

/**
 * Parse a single numeric query param into a finite integer.
 *
 * Only single string values are accepted; an absent value falls back to
 * `fallback`, while array-form params (e.g. `?since=1&since=2`, which Express
 * surfaces as a string array) and non-numeric strings yield `null` so the
 * caller can reject them explicitly instead of silently producing `NaN`.
 *
 * @param value    - The raw `req.query[...]` value (string, string[], or undefined).
 * @param fallback - The value to use when the param is absent.
 * @returns A finite integer, or `null` when the input is array-form or non-numeric.
 */
const parseIntegerQueryParam = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};
/**
 * Decode a base64-encoded cursor string into an integer offset.
 *
 * Returns the decoded offset on success, or `"bad"` when the cursor is
 * present but malformed (non-base64, non-integer, or negative).  Returns
 * `undefined` when no cursor was supplied so the caller can distinguish
 * "first page" from an explicit bad value.
 *
 * @param raw - The raw `req.query.cursor` value (string, string[], or undefined).
 * @returns The decoded integer offset, `"bad"` for a malformed cursor, or
 *          `undefined` when the param is absent.
 */
const parseCursor = (raw: unknown): number | "bad" | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim() === "") return "bad";
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (!/^(0|[1-9][0-9]{0,14})$/.test(decoded)) return "bad";
    const n = Number(decoded);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return "bad";
    return n;
  } catch {
    return "bad";
  }
};

/**
 * Apply limit+cursor pagination to an array of items.
 *
 * @param items  - The full (pre-filtered) array.
 * @param limit  - Number of items per page (already clamped by caller).
 * @param offset - Starting index decoded from the cursor (0 when absent).
 * @returns The page slice and a `nextCursor` (base64-encoded next offset,
 *          or `null` when the collection is exhausted).
 */
const paginate = <T>(
  items: T[],
  limit: number,
  offset: number
): { page: T[]; nextCursor: string | null } => {
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < items.length
    ? Buffer.from(String(nextOffset)).toString("base64")
    : null;
  return { page, nextCursor };
};



app.get("/api/v1/events", (req: Request, res: Response) => {
  // `since` must be a single, non-negative integer. Array-form or non-numeric
  // values are rejected rather than coerced to NaN (which would silently
  // return zero events).
  const since = parseIntegerQueryParam(req.query.since, 0);
  if (since === null || since < 0) {
    sendError(res, req, 400, "invalid_request", "since must be a non-negative integer");
    return;
  }

  // `limit` must be a single numeric value; it is then clamped to [1, EVENT_LOG_CAP].
  const rawLimit = parseIntegerQueryParam(req.query.limit, 100);
  if (rawLimit === null) {
    sendError(res, req, 400, "invalid_request", "limit must be a single integer");
    return;
  }
  const limit = Math.min(EVENT_LOG_CAP, Math.max(1, rawLimit));

  // Optional type filter: when present, must be one of the known event types.
  const typeParam = req.query.type;
  if (typeParam !== undefined) {
    if (
      typeof typeParam !== "string" ||
      !(KNOWN_EVENT_TYPES as ReadonlyArray<string>).includes(typeParam)
    ) {
      sendError(
        res,
        req,
        400,
        "invalid_request",
        `type must be one of: ${KNOWN_EVENT_TYPES.join(", ")}`
      );
      return;
    }
  }

  // Parse cursor (base64-encoded offset).
  const cursorResult = parseCursor(req.query.cursor);
  if (cursorResult === "bad") {
    sendError(res, req, 400, "invalid_request", "cursor is invalid");
    return;
  }
  const offset = cursorResult ?? 0;

  let items = eventLog.filter((e) => e.ts >= since).reverse();
  if (typeParam !== undefined) {
    items = items.filter((e) => e.type === (typeParam as EventType));
  }
  const { page, nextCursor } = paginate(items, limit, offset);
  res.json({ items: page, nextCursor });
});

/**
 * Fixed catalog of authorization scopes an API key may carry. A key's scopes
 * are a subset of this set; unknown scope strings are rejected at creation.
 *
 * | Scope            | Description                                              |
 * | ---------------- | -------------------------------------------------------- |
 * | `pairs:write`    | Create, update, and delete trading pairs                 |
 * | `webhooks:write` | Register and revoke webhook subscriptions                |
 * | `keys:admin`     | Create, rotate, and revoke API keys                      |
 *
 * A key without any scope (i.e. an empty array) is read-only and can only call
 * endpoints that do not require a scope.
 */
export const SCOPE_CATALOG = ["pairs:write", "webhooks:write", "keys:admin"] as const;

/**
 * Least-privilege default scope set applied when a key is created without an
 * explicit `scopes` array. Read-only: it grants no write scope.
 */
const DEFAULT_SCOPES: readonly string[] = [];

/**
 * Validates whether a given API key record is currently active and usable.
 *
 * A key is considered valid if and only if:
 * 1. It has not reached its explicit expiration time (`expiresAt`), if one was set.
 * 2. If it was rotated, its grace period (`graceExpiresAt`) has not expired.
 *
 * @param record - The API key record retrieved from the store.
 * @returns `true` if the key is valid and usable; otherwise `false`.
 */
export const isKeyValid = (record: ApiKeyRecord): boolean => {
  if (record.expiresAt !== undefined && Date.now() > record.expiresAt) return false;
  if (record.graceExpiresAt !== undefined && record.rotatedAt !== undefined) {
    // Rotated predecessor: still valid until grace window expires
    return Date.now() <= record.graceExpiresAt;
  }
  return true;
};

/**
 * Express middleware factory asserting that the authenticated API key carries
 * the given scope.
 *
 * The key is resolved from the `Authorization: Bearer <srk_...>` header. When
 * the key is missing or unknown the guard responds `401 unauthorized`; when the
 * key exists but lacks `scope` it responds `403 forbidden`, both using the
 * canonical `sendError` envelope. On success it calls `next()`.
 *
 * @param scope - The scope string (from {@link SCOPE_CATALOG}) the route requires.
 * @returns An Express request handler enforcing the scope.
 */
export const requireScope = (scope: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    const rawKey = match ? match[1] : undefined;
    if (!rawKey) {
      sendError(res, req, 401, "unauthorized", "a valid API key is required");
      return;
    }
    const prefix = apiKeyPrefix(rawKey);
    const record = apiKeyStore.get(prefix);
    if (!record || !isKeyValid(record) || !verifyApiKeySecret(rawKey, record)) {
      sendError(res, req, 401, "unauthorized", "a valid API key is required");
      return;
    }
    if (!(record.scopes ?? []).includes(scope)) {
      sendError(res, req, 403, "forbidden", `this key is missing the required scope: ${scope}`);
      return;
    }
    apiKeyStore.set(prefix, { ...record, lastUsedAt: Date.now() });
    next();
  };

/**
 * Mint a fresh `srk_` API key together with the salted-hash record fields to
 * store for it, retrying on the (astronomically unlikely) event that the
 * derived prefix collides with one already in `apiKeyStore` — since the
 * prefix doubles as the store's lookup key, it must be unique.
 */
const mintApiKey = (): { key: string; prefix: string; salt: string; hash: string } => {
  let key: string;
  let prefix: string;
  do {
    key = `srk_${randomUUID().replace(/-/g, "")}`;
    prefix = apiKeyPrefix(key);
  } while (apiKeyStore.has(prefix));
  const salt = generateApiKeySalt();
  const hash = hashApiKeySecret(key, salt);
  return { key, prefix, salt, hash };
};

app.delete("/api/v1/api-keys/:prefix", (req: Request, res: Response) => {
  const { prefix } = req.params;
  if (!apiKeyStore.has(prefix)) {
    sendError(res, req, 404, "not_found", `no key with prefix ${prefix}`);
    return;
  }
  apiKeyStore.delete(prefix);
  recordEvent("apikey.deleted", { prefix });
  res.status(204).send();
});

app.get("/api/v1/api-keys", (req: Request, res: Response) => {
  const rawLimit = parseIntegerQueryParam(req.query.limit, 100);
  if (rawLimit === null) {
    sendError(res, req, 400, "invalid_request", "limit must be a single integer");
    return;
  }
  const limit = Math.min(500, Math.max(1, rawLimit));

  const cursorResult = parseCursor(req.query.cursor);
  if (cursorResult === "bad") {
    sendError(res, req, 400, "invalid_request", "cursor is invalid");
    return;
  }
  const offset = cursorResult ?? 0;

  const allItems = Array.from(apiKeyStore.entries()).map(([prefix, m]) => ({
    prefix,
    label: m.label,
    createdAt: m.createdAt,
    scopes: m.scopes ?? [],
    // Surface rotation metadata for predecessor records (omitted when absent).
    ...(m.rotatedAt !== undefined ? { rotatedAt: m.rotatedAt } : {}),
    ...(m.expiresAt !== undefined ? { expiresAt: m.expiresAt } : {}),
    ...(m.lastUsedAt !== undefined ? { lastUsedAt: m.lastUsedAt } : {}),
  }));
  const { page, nextCursor } = paginate(allItems, limit, offset);
  res.json({ items: page, nextCursor });
});

app.post("/api/v1/api-keys", idempotencyGuard, (req: Request, res: Response) => {
  if (rejectUnknownKeys(req, res, ["label", "scopes", "expiresInSeconds"])) return;
  const { label, scopes, expiresInSeconds } = req.body ?? {};
  if (typeof label !== "string" || label.length === 0 || label.length > 64) {
    sendError(res, req, 400, "invalid_request", "label must be 1-64 chars");
    return;
  }
  let grantedScopes: string[] = [...DEFAULT_SCOPES];
  if (scopes !== undefined) {
    if (!Array.isArray(scopes) || scopes.some((s) => typeof s !== "string")) {
      sendError(res, req, 400, "invalid_request", "scopes must be a string array");
      return;
    }
    const unknown = (scopes as string[]).filter(
      (s) => !(SCOPE_CATALOG as ReadonlyArray<string>).includes(s)
    );
    if (unknown.length > 0) {
      sendError(
        res,
        req,
        400,
        "invalid_request",
        `unknown scope(s): ${unknown.join(", ")}. Known scopes: ${SCOPE_CATALOG.join(", ")}`
      );
      return;
    }
    grantedScopes = [...new Set(scopes as string[])];
  }
  let expiresAt: number | undefined;
  if (expiresInSeconds !== undefined) {
    if (
      typeof expiresInSeconds !== "number" ||
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds <= 0 ||
      expiresInSeconds > 31_536_000
    ) {
      sendError(res, req, 400, "invalid_request", "expiresInSeconds must be a positive integer no greater than 31536000");
      return;
    }
    expiresAt = Date.now() + expiresInSeconds * 1000;
  }
  const { key, prefix, salt, hash } = mintApiKey();
  apiKeyStore.set(prefix, {
    label,
    createdAt: Date.now(),
    scopes: grantedScopes,
    salt,
    hash,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
  // Record only the non-sensitive prefix and label — never the raw key.
  recordEvent("apikey.created", { prefix, label });
  res.status(201).json({ key, label, scopes: grantedScopes, ...(expiresAt !== undefined ? { expiresAt } : {}) });
});

/**
 * Grace window (ms) during which a rotated predecessor key remains valid
 * alongside its successor, giving in-flight callers time to cut over without
 * downtime. Defaults to one hour.
 */
const ROTATION_GRACE_MS = 60 * 60 * 1000;

/**
 * Rotate an API key: mint a successor inheriting the predecessor's label and
 * schedule the predecessor for grace expiry.
 *
 * Locates the key by its 8-char prefix, creates a new `srk_` key with the same
 * `label`, and stamps the predecessor with `rotatedAt` (now) and
 * `graceExpiresAt` (now + {@link ROTATION_GRACE_MS}) so both keys work during
 * the overlap. The new raw key is returned exactly once with `201`; it is never
 * logged. Returns `404 not_found` for an unknown prefix.
 *
 * @route POST /api/v1/api-keys/:prefix/rotate
 */
app.post("/api/v1/api-keys/:prefix/rotate", (req: Request, res: Response) => {
  const { prefix } = req.params;
  const predecessor = apiKeyStore.get(prefix);
  if (!predecessor) {
    sendError(res, req, 404, "not_found", `no key with prefix ${prefix}`);
    return;
  }
  const now = Date.now();
  // Stamp the predecessor with rotation metadata; it stays valid until grace expiry.
  apiKeyStore.set(prefix, {
    ...predecessor,
    rotatedAt: now,
    graceExpiresAt: now + ROTATION_GRACE_MS,
  });
  // Mint the successor, inheriting the label and scopes.
  const { key: newKey, prefix: newPrefix, salt, hash } = mintApiKey();
  apiKeyStore.set(newPrefix, {
    label: predecessor.label,
    createdAt: now,
    scopes: predecessor.scopes,
    salt,
    hash,
  });
  res.status(201).json({ key: newKey, label: predecessor.label, graceExpiresAt: now + ROTATION_GRACE_MS });
});

app.delete("/api/v1/webhooks/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!webhookStore.has(id)) {
    sendError(res, req, 404, "not_found", `webhook ${id} not found`);
    return;
  }
  webhookStore.delete(id);
  recordEvent("webhook.deleted", { id });
  res.status(204).send();
});

app.get("/api/v1/webhooks", (req: Request, res: Response) => {
  const rawLimit = parseIntegerQueryParam(req.query.limit, 100);
  if (rawLimit === null) {
    sendError(res, req, 400, "invalid_request", "limit must be a single integer");
    return;
  }
  const limit = Math.min(500, Math.max(1, rawLimit));

  const cursorResult = parseCursor(req.query.cursor);
  if (cursorResult === "bad") {
    sendError(res, req, 400, "invalid_request", "cursor is invalid");
    return;
  }
  const offset = cursorResult ?? 0;

  const allItems = Array.from(webhookStore.entries()).map(([id, m]) => ({ id, ...m }));
  const { page, nextCursor } = paginate(allItems, limit, offset);
  res.json({ items: page, nextCursor });
});

/**
 * Validate a set of webhook events. Sends error if invalid and returns null,
 * otherwise returns deduplicated array of valid event names.
 */
const validateWebhookEvents = (res: Response, req: Request, events: unknown): string[] | null => {
  if (!Array.isArray(events) || events.length === 0 || events.some((e) => typeof e !== "string")) {
    sendError(res, req, 400, "invalid_request", "events must be a non-empty string array");
    return null;
  }
  if (events.length > WEBHOOK_MAX_EVENTS) {
    sendError(res, req, 400, "invalid_request", `events may contain at most ${WEBHOOK_MAX_EVENTS} entries`);
    return null;
  }
  for (const name of events as string[]) {
    if (name.trim().length === 0) {
      sendError(res, req, 400, "invalid_request", "event names must not be blank or whitespace-only");
      return null;
    }
    if (name.length > WEBHOOK_MAX_EVENT_LENGTH) {
      sendError(res, req, 400, "invalid_request", `event names must be <= ${WEBHOOK_MAX_EVENT_LENGTH} chars`);
      return null;
    }
    if (WEBHOOK_RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
      sendError(res, req, 400, "invalid_request", `event name "${name}" uses a reserved prefix`);
      return null;
    }
    // Event names must be either "*" (wildcard) or follow the "namespace.action"
    // convention (exactly one dot, alphanumeric segments). Names with multiple
    // dots are rejected as they indicate a typo or unsupported format.
    if (name !== "*" && !/^[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_]+$/.test(name)) {
      sendError(res, req, 400, "invalid_request", `event name "${name}" must be "*" or follow "namespace.action" format`);
      return null;
    }
  }
  return [...new Set(events as string[])];
};

app.post("/api/v1/webhooks", idempotencyGuard, (req: Request, res: Response) => {
  if (rejectUnknownKeys(req, res, ["url", "events"])) return;
  const { url, events } = req.body ?? {};
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || url.length > 2048) {
    sendError(res, req, 400, "invalid_request", "url must be http(s), <=2048 chars");
    return;
  }
  if (!isSafeWebhookUrl(url)) {
    sendError(res, req, 400, "invalid_request", "url host must be public");
    return;
  }
  const deduped = validateWebhookEvents(res, req, events);
  if (deduped === null) return;
  const id = `wh_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  webhookStore.set(id, { url, events: deduped, createdAt: Date.now() });
  // Record id and url only — never any webhook secret material.
  recordEvent("webhook.created", { id, url });
  res.status(201).json({ id, url, events: deduped });
});

/**
 * Read a single registered webhook by id.
 *
 * Returns `{ id, url, events, createdAt }` for a known id, or
 * `404 not_found` (with the canonical `requestId` envelope) otherwise.
 *
 * @route GET /api/v1/webhooks/:id
 */
app.get("/api/v1/webhooks/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const record = webhookStore.get(id);
  if (!record) {
    sendError(res, req, 404, "not_found", `webhook ${id} not found`);
    return;
  }
  res.json({ id, ...record });
});

/**
 * Update a registered webhook's subscribed `events` in place.
 *
 * The `url` is intentionally immutable on PATCH: changing the destination
 * should go through delete/recreate so the SSRF-validation provenance of the
 * URL is preserved. The new `events` value is validated with the same
 * non-empty-string-array rule used by the create handler and deduplicated
 * before being stored. Returns the updated webhook, or `404 not_found` when
 * the id is unknown.
 *
 * @route PATCH /api/v1/webhooks/:id
 */
app.patch("/api/v1/webhooks/:id", (req: Request, res: Response) => {
  if (rejectUnknownKeys(req, res, ["events"])) return;
  const { id } = req.params;
  const record = webhookStore.get(id);
  if (!record) {
    sendError(res, req, 404, "not_found", `webhook ${id} not found`);
    return;
  }
  const { events } = req.body ?? {};
  const deduped = validateWebhookEvents(res, req, events);
  if (deduped === null) return;
  // url is preserved; only events are mutated.
  const updated = { ...record, events: deduped };
  webhookStore.set(id, updated);
  res.json({ id, ...updated });
});


/**
 * Normalize the `:source`/`:destination` route params to their canonical asset
 * codes via {@link normalizeAsset}. On invalid input a `400 invalid_request` is
 * sent and `null` is returned so the caller can `return` immediately.
 */
const normalizePairParams = (
  req: Request,
  res: Response
): { source: string; destination: string } | null => {
  const source = normalizeAsset(req.params.source);
  const destination = normalizeAsset(req.params.destination);
  if (source === null || destination === null) {
    sendError(res, req, 400, "invalid_request", "source and destination must be 1-12 alphanumeric characters");
    return null;
  }
  return { source, destination };
};

/** Aggregate read of every per-pair slot in one round-trip. */
app.get("/api/v1/pairs/:source/:destination/info", (req: Request, res: Response) => {
  const normalized = normalizePairParams(req, res);
  if (!normalized) return;
  const { source, destination } = normalized;
  const k = pairKey(source, destination);
  res.json({
    source,
    destination,
    registered: pairRegistry.has(k),
    ...(pairMeta.get(k) ?? defaultMeta()),
  });
});

/**
 * Factory that creates an Express PATCH handler for a single `PairMeta` field.
 *
 * All four per-pair PATCH routes share the same flow:
 *   1. Resolve the pair key from `:source` / `:destination` params.
 *   2. Guard with a 404 if the pair is not registered.
 *   3. Validate the inbound value with the field-specific `validate` function.
 *   4. Mutate exactly the bound `field` on the stored metadata.
 *   5. Respond with `{ source, destination, ...meta }`.
 *
 * Binding the field name at registration time means the handler can never
 * accidentally mutate a different field, even if the descriptor table is
 * extended in the future.
 *
 * @param field        - The key of `PairMeta` this handler is responsible for.
 * @param bodyKey      - The request-body property name carrying the incoming value.
 * @param validate     - Returns `true` when the value is acceptable, `false` to reject.
 * @param errorMessage - The `message` string sent in the 400 response body.
 */
const makePairMetaPatch = <K extends keyof PairMeta>(
  field: K,
  bodyKey: string,
  validate: (v: unknown) => boolean,
  errorMessage: string,
  crossCheck?: (value: unknown, meta: PairMeta) => string | null
) =>
  (req: Request, res: Response): void => {
    const normalized = normalizePairParams(req, res);
    if (!normalized) return;
    const { source, destination } = normalized;
    const k = pairKey(source, destination);
    if (!pairRegistry.has(k)) {
      sendError(res, req, 404, "not_found", "pair not registered");
      return;
    }
    if (rejectUnknownKeys(req, res, [bodyKey])) return;
    const value = (req.body ?? {})[bodyKey] as unknown;
    if (!validate(value)) {
      sendError(res, req, 400, "invalid_request", errorMessage);
      return;
    }
    const meta = pairMeta.get(k) ?? defaultMeta();
    // Optional cross-field invariant (e.g. min <= max). Runs after the
    // per-field format check so `value` is already known to be a valid
    // integer string; comparisons stay in BigInt space (see crossCheck impls).
    if (crossCheck) {
      const crossError = crossCheck(value, meta);
      if (crossError !== null) {
        sendError(res, req, 400, "invalid_request", crossError);
        return;
      }
    }
    (meta as Record<string, unknown>)[field] = value;
    pairMeta.set(k, meta);
    res.json({ source, destination, ...meta });
  };

/**
 * Cross-field guard for `PATCH .../min`.
 *
 * Rejects a new `minAmount` that would exceed the pair's existing **non-zero**
 * `maxAmount` (a `maxAmount` of `"0"` is treated as "unset" and never triggers
 * the check). Both values are compared as `BigInt` to preserve precision on
 * amounts above `Number.MAX_SAFE_INTEGER`; the input is never coerced through
 * `Number`.
 *
 * @returns An error message naming both bounds when inconsistent, else `null`.
 */
const checkMinAgainstMax = (value: unknown, meta: PairMeta): string | null => {
  const newMin = BigInt(value as string);
  const existingMax = BigInt(meta.maxAmount);
  if (existingMax !== 0n && newMin > existingMax) {
    return `minAmount (${newMin}) must not exceed the current maxAmount (${existingMax})`;
  }
  return null;
};

/**
 * Cross-field guard for `PATCH .../max`.
 *
 * Rejects a new `maxAmount` that would fall below the pair's existing
 * **non-zero** `minAmount` (a `minAmount` of `"0"` is treated as "unset").
 * Comparisons are performed entirely in `BigInt` space.
 *
 * @returns An error message naming both bounds when inconsistent, else `null`.
 */
const checkMaxAgainstMin = (value: unknown, meta: PairMeta): string | null => {
  const newMax = BigInt(value as string);
  const existingMin = BigInt(meta.minAmount);
  if (existingMin !== 0n && newMax < existingMin) {
    return `maxAmount (${newMax}) must not be below the current minAmount (${existingMin})`;
  }
  return null;
};

/**
 * Cross-field guard for `PATCH .../liquidity`.
 *
 * Rejects a new `liquidity` below the pair's existing **non-zero** `minAmount`
 * (a `minAmount` of `"0"` is treated as "unset"; a liquidity of `"0"` is also
 * treated as "unset" and never triggers the check).
 *
 * @returns An error message when inconsistent, else `null`.
 */
const checkLiquidityAgainstMin = (value: unknown, meta: PairMeta): string | null => {
  const newLiquidity = BigInt(value as string);
  if (newLiquidity === 0n) return null; // "0" means unset — always allowed
  const existingMin = BigInt(meta.minAmount);
  if (existingMin !== 0n && newLiquidity < existingMin) {
    return `liquidity (${newLiquidity}) must not be below the current minAmount (${existingMin})`;
  }
  return null;
};

/**
 * Cross-field guard for `PATCH .../min` (against liquidity).
 *
 * Rejects a new `minAmount` above the pair's existing **non-zero** `liquidity`
 * (a `liquidity` of `"0"` is treated as "unset" and never triggers the check).
 *
 * @returns An error message when inconsistent, else `null`.
 */
const checkMinAgainstLiquidity = (value: unknown, meta: PairMeta): string | null => {
  const newMin = BigInt(value as string);
  const existingLiquidity = BigInt(meta.liquidity);
  if (existingLiquidity !== 0n && newMin > existingLiquidity) {
    return `minAmount (${newMin}) must not exceed the current liquidity (${existingLiquidity})`;
  }
  return null;
};

/**
 * Descriptor table driving the four per-pair PATCH routes.
 * Each entry maps a URL suffix to its PairMeta field, body key, validator, and
 * error message — the only dimensions that differ between the four handlers.
 * Reuses the same regexes / number checks as the original inline handlers.
 */
const pairMetaPatchDescriptors: Array<{
  suffix: string;
  field: keyof PairMeta;
  bodyKey: string;
  validate: (v: unknown) => boolean;
  errorMessage: string;
  crossCheck?: (value: unknown, meta: PairMeta) => string | null;
}> = [
  {
    suffix: "liquidity",
    field: "liquidity",
    bodyKey: "liquidity",
    validate: (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v),
    errorMessage: "liquidity must be a non-negative integer string",
    crossCheck: checkLiquidityAgainstMin,
  },
  {
    suffix: "max",
    field: "maxAmount",
    bodyKey: "maxAmount",
    validate: (v) => typeof v === "string" && /^[1-9][0-9]{0,38}$/.test(v),
    errorMessage: "maxAmount must be a positive integer string",
    crossCheck: checkMaxAgainstMin,
  },
  {
    suffix: "min",
    field: "minAmount",
    bodyKey: "minAmount",
    validate: (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v),
    errorMessage: "minAmount must be a non-negative integer string",
    crossCheck: (value, meta) => checkMinAgainstMax(value, meta) ?? checkMinAgainstLiquidity(value, meta),
  },
  {
    suffix: "fee_bps",
    field: "feeBps",
    bodyKey: "feeBps",
    validate: (v) =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000,
    errorMessage: "feeBps must be an integer in [0,1000]",
  },
  {
    suffix: "rate",
    field: "rate",
    bodyKey: "rate",
    validate: (v) => {
      if (typeof v !== "string") return false;
      if (v.length > 20) return false; // bound precision
      return /^[0-9]+(\.[0-9]{1,8})?$/.test(v) && parseFloat(v) > 0;
    },
    errorMessage:
      'rate must be a positive decimal string (e.g. "1.0", "0.85"), max 8 decimal places',
  },
];

// Register each descriptor as a PATCH route.
for (const { suffix, field, bodyKey, validate, errorMessage, crossCheck } of pairMetaPatchDescriptors) {
  app.patch(
    `/api/v1/pairs/:source/:destination/${suffix}`,
    makePairMetaPatch(field, bodyKey, validate, errorMessage, crossCheck)
  );
}

/**
 * Toggle a pair's enabled flag.
 *
 * Accepts `{ enabled: boolean }` and emits a `pair.enabled` or `pair.disabled`
 * audit event on each toggle. Non-boolean bodies are rejected with 400.
 *
 * @route PATCH /api/v1/pairs/:source/:destination/enabled
 */
app.patch("/api/v1/pairs/:source/:destination/enabled", (req: Request, res: Response): void => {
  const normalized = normalizePairParams(req, res);
  if (!normalized) return;
  const { source, destination } = normalized;
  const k = pairKey(source, destination);
  if (!pairRegistry.has(k)) {
    sendError(res, req, 404, "not_found", "pair not registered");
    return;
  }
  if (rejectUnknownKeys(req, res, ["enabled"])) return;
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    sendError(res, req, 400, "invalid_request", "enabled must be a boolean");
    return;
  }
  const meta = pairMeta.get(k) ?? defaultMeta();
  meta.enabled = enabled;
  pairMeta.set(k, meta);
  recordEvent(enabled ? "pair.enabled" : "pair.disabled", { source, destination });
  res.json({ source, destination, ...meta });
});

/**
 * Reset a registered pair's metadata to factory defaults.
 *
 * Overwrites the pair's `pairMeta` entry with `defaultMeta()`, emits a
 * `pair.meta.reset` audit event, and returns the fresh metadata. Blocked
 * while the service is paused (non-idempotent POST). Returns 404 when the
 * pair is not registered.
 *
 * @route POST /api/v1/pairs/:source/:destination/reset
 */
app.post("/api/v1/pairs/:source/:destination/reset", (req: Request, res: Response) => {
  const { source, destination } = req.params;
  const k = pairKey(source, destination);
  if (!pairRegistry.has(k)) {
    sendError(res, req, 404, "not_found", "pair not registered");
    return;
  }
  const meta = defaultMeta();
  pairMeta.set(k, meta);
  recordEvent("pair.meta.reset", { source, destination });
  res.json({ source, destination, ...meta });
});

/** Unregister a pair. */
app.delete("/api/v1/pairs/:source/:destination", (req: Request, res: Response) => {
  const { source, destination } = req.params;
  const k = pairKey(source, destination);
  if (!pairRegistry.has(k)) {
    sendError(res, req, 404, "not_found", `pair ${source}->${destination} is not registered`);
    return;
  }
  pairRegistry.delete(k);
  recordEvent("pair.unregistered", { source, destination });
  res.status(204).send();
});

/** Read a single registered pair. */
app.get("/api/v1/pairs/:source/:destination", (req: Request, res: Response) => {
  const { source, destination } = req.params;
  if (!pairRegistry.has(pairKey(source, destination))) {
    sendError(res, req, 404, "not_found", `pair ${source}->${destination} is not registered`);
    return;
  }
  res.json({ source, destination, registered: true });
});

app.get("/api/v1/admin/status", (_req: Request, res: Response) => {
  res.json({ paused: isPaused(), readOnly: isReadOnly() });
});

app.get("/api/v1/config", (_req: Request, res: Response) => res.json({ config }));
app.patch("/api/v1/config", (req: Request, res: Response) => {
  const allowed = ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems", "eventLogCap", "quote_ttl_ms"] as const;
  if (rejectUnknownKeys(req, res, [...allowed])) return;
  for (const k of allowed) {
    if (k in (req.body ?? {})) {
      const v = req.body[k];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
        sendError(res, req, 400, "invalid_request", `${k} must be positive integer`);
        return;
      }
      if (k === "bulkMaxItems" && v > BULK_ABSOLUTE_MAX) {
        sendError(res, req, 400, "invalid_request", `bulkMaxItems cannot exceed ${BULK_ABSOLUTE_MAX}`);
        return;
      }
      if (k === "eventLogCap" && v > EVENT_LOG_CAP_MAX) {
        sendError(res, req, 400, "invalid_request", `eventLogCap cannot exceed ${EVENT_LOG_CAP_MAX}`);
        return;
      }
      config[k] = v;
      // Trim the event log immediately when the cap is lowered so that the
      // buffer stays within the new bound without waiting for the next write.
      if (k === "eventLogCap") trimEventLog(v);
    }
  }
  res.json({ config });
});

/**
 * Escape a Prometheus label value per the exposition format rules:
 * backslash → \\, double-quote → \", newline → \n.
 *
 * @param value - Raw label value string.
 * @returns Escaped string safe for use inside double-quoted label values.
 */
const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/**
 * Aggregate event counts from the in-memory event log.
 *
 * Returns a Map from event type to count.  Only types present in
 * {@link KNOWN_EVENT_TYPES} are included so the series set is stable.
 *
 * @param log - The current event log array.
 * @returns Map of event type → count for each known type.
 */
const aggregateEventCounts = (log: AppEvent[]): Map<string, number> => {
  const counts = new Map<string, number>(KNOWN_EVENT_TYPES.map((t) => [t, 0]));
  for (const event of log) {
    if (counts.has(event.type)) {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
  }
  return counts;
};

/**
 * Build the label-free store-size and config gauges exposed in `/metrics`.
 *
 * Each metric is a bounded, constant-cardinality gauge derived from an
 * in-memory store size or the active `config`, emitted with its `# HELP` and
 * `# TYPE` comment lines in Prometheus text exposition format. No labels are
 * used, so scrape cardinality stays constant, and no raw secrets or URLs are
 * ever included — only counts and the configured rate limit.
 *
 * @returns Array of exposition lines (HELP/TYPE/value triples) ready to join.
 */
const buildStoreGaugeLines = (): string[] => [
  "# HELP stableroute_api_keys_total Number of stored API keys.",
  "# TYPE stableroute_api_keys_total gauge",
  `stableroute_api_keys_total ${apiKeyStore.size}`,
  "# HELP stableroute_webhooks_total Number of registered webhooks.",
  "# TYPE stableroute_webhooks_total gauge",
  `stableroute_webhooks_total ${webhookStore.size}`,
  "# HELP stableroute_event_log_size Current number of entries in the event log.",
  "# TYPE stableroute_event_log_size gauge",
  `stableroute_event_log_size ${eventLog.length}`,
  "# HELP stableroute_rate_limit_per_window Configured request limit per rate-limit window.",
  "# TYPE stableroute_rate_limit_per_window gauge",
  `stableroute_rate_limit_per_window ${config.rateLimitPerWindow ?? 0}`,
];

app.get("/api/v1/metrics", (_req: Request, res: Response) => {
  const eventCounts = aggregateEventCounts(eventLog);

  const lines = [
    "# HELP stableroute_pairs_total Number of registered pairs.",
    "# TYPE stableroute_pairs_total gauge",
    `stableroute_pairs_total ${pairRegistry.size}`,
    "# HELP stableroute_paused 1 if paused, 0 otherwise.",
    "# TYPE stableroute_paused gauge",
    `stableroute_paused ${isPaused() ? 1 : 0}`,
    "# HELP stableroute_events_total Total number of events in the audit log.",
    "# TYPE stableroute_events_total gauge",
    `stableroute_events_total ${eventLog.length}`,
    "# HELP stableroute_events_by_type Count of events in the audit log per type.",
    "# TYPE stableroute_events_by_type gauge",
    ...Array.from(eventCounts.entries()).map(
      ([type, count]) =>
        `stableroute_events_by_type{type="${escapeLabelValue(type)}"} ${count}`
    ),
    ...buildStoreGaugeLines(),
  ];
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(lines.join("\n") + "\n");
});

/**
 * Derive per-pair aggregates from the registry and metadata maps.
 *
 * Computes, in a single O(n) pass over the registered pairs:
 * - `pairsWithFee`   — count of pairs whose stored `feeBps > 0`.
 * - `distinctAssets` — number of unique asset codes appearing as either the
 *   source or destination of any registered pair.
 *
 * Side-effect free: reads only the existing in-memory stores and allocates no
 * new persistent state.
 *
 * @returns `{ pairsWithFee, distinctAssets }`.
 */
const aggregatePairStats = (): { pairsWithFee: number; distinctAssets: number } => {
  let pairsWithFee = 0;
  const assets = new Set<string>();
  for (const k of pairRegistry) {
    const [source, destination] = k.split("::");
    assets.add(source);
    assets.add(destination);
    if ((pairMeta.get(k)?.feeBps ?? 0) > 0) pairsWithFee += 1;
  }
  return { pairsWithFee, distinctAssets: assets.size };
};

app.get("/api/v1/stats", (_req: Request, res: Response) => {
  const { pairsWithFee, distinctAssets } = aggregatePairStats();
  res.json({
    totalPairs: pairRegistry.size,
    paused: isPaused(),
    totalApiKeys: apiKeyStore.size,
    totalWebhooks: webhookStore.size,
    totalEvents: eventLog.length,
    pairsWithFee,
    distinctAssets,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pair registry
// ─────────────────────────────────────────────────────────────────────────────
//
// In-memory mirror of the on-chain DataKey::Pair(source, dest) set the
// router contract maintains. The settlement worker fans out from the
// contract to this Map on startup and on every pair-registration event.
// Process restart resets the map; persistence lands with the database
// adapter.
/**
 * Serialize the current pair registry to a JSON string.
 * Shared between the GET and HEAD handlers so the two always produce
 * byte-identical output and therefore byte-identical ETags.
 */
const serializePairs = (): string => {
  const pairs = Array.from(pairRegistry).map((k) => {
    const [source, destination] = k.split("::");
    return { source, destination };
  });
  return JSON.stringify({ pairs });
};

/**
 * Compute the weak ETag for the pairs list body.
 * Uses a base64-truncated SHA-1 digest, identical to the original GET handler.
 *
 * @param body - the already-serialized JSON string returned by serializePairs()
 */
const pairsEtag = (body: string): string =>
  `W/"${createHash("sha1").update(body).digest("base64").slice(0, 16)}"`;

/**
 * List every registered (source, destination) pair.
 * Response: { pairs: [{ source, destination }, ...] }
 */
app.get("/api/v1/pairs", (req: Request, res: Response) => {
  const rawLimit = parseIntegerQueryParam(req.query.limit, 100);
  if (rawLimit === null) {
    sendError(res, req, 400, "invalid_request", "limit must be a single integer");
    return;
  }
  const limit = Math.min(500, Math.max(1, rawLimit));

  const cursorResult = parseCursor(req.query.cursor);
  if (cursorResult === "bad") {
    sendError(res, req, 400, "invalid_request", "cursor is invalid");
    return;
  }
  const offset = cursorResult ?? 0;

  const allPairs = Array.from(pairRegistry).map((k) => {
    const [source, destination] = k.split("::");
    return { source, destination };
  });
  const { page, nextCursor } = paginate(allPairs, limit, offset);
  const body = JSON.stringify({ pairs: page, nextCursor });
  const etag = pairsEtag(body);
  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.type("application/json").send(body);
});

/**
 * HEAD /api/v1/pairs
 *
 * Returns the same ETag, Content-Type, and Content-Length as GET but with
 * no body. A well-behaved cache can use this to learn the current ETag and
 * body size without transferring the full pairs list.
 *
 * Honors If-None-Match: responds 304 when the client's cached ETag matches,
 * and 200 (empty body) otherwise. Respects the pause guard identically to GET.
 */
app.head("/api/v1/pairs", (req: Request, res: Response) => {
  const body = serializePairs();
  const etag = pairsEtag(body);
  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body).toString());
  res.status(200).end();
});

/**
 * Register a pair (test-only / operator surface; will move behind an
 * admin auth guard once the gateway lands). Body: { source, destination }.
 * Returns 201 on first-write, 200 on idempotent re-write.
 */
app.post("/api/v1/pairs", idempotencyGuard, (req: Request, res: Response) => {
  if (rejectUnknownKeys(req, res, ["source", "destination"])) return;
  const { source: rawSource, destination: rawDestination } = req.body ?? {};
  const source = normalizeAsset(rawSource);
  const destination = normalizeAsset(rawDestination);
  if (source === null || destination === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source and destination must be 1-12 alphanumeric characters"
    );
  }
  if (source === destination) {
    return sendError(res, req, 400, "invalid_request", "source and destination must differ");
  }
  const key = pairKey(source, destination);
  const isNew = !pairRegistry.has(key);
  pairRegistry.add(key);
  recordEvent(isNew ? "pair.registered" : "pair.refreshed", { source, destination });
  res.status(isNew ? 201 : 200).json({ source, destination, registered: true });
});

/**
 * Register many pairs in a single request, returning a per-item outcome.
 *
 * Body: `{ pairs: [{ source, destination }, ...] }` with 1–`config.bulkMaxItems`
 * entries. Each item is validated independently with the same `isAssetCode` and
 * same-asset rules as the single-pair endpoint; one bad item never fails the
 * whole batch. A `pair.registered` / `pair.refreshed` event is recorded for
 * each successfully registered item exactly as the single endpoint does.
 *
 * Per-item result shape:
 *   - success: `{ index, ok: true, source, destination, registered: true }`
 *   - failure: `{ index, ok: false, error }`
 *
 * Returns `400 invalid_request` only when the `pairs` array itself is missing,
 * empty, or exceeds the configured cap.
 *
 * @route POST /api/v1/pairs/bulk
 */
app.post("/api/v1/pairs/bulk", (req: Request, res: Response) => {
  const { pairs } = req.body ?? {};
  const maxItems = config.bulkMaxItems;
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > maxItems) {
    sendError(res, req, 400, "invalid_request", `pairs must be 1-${maxItems} entries`);
    return;
  }
  const results = pairs.map(
    (it: { source?: unknown; destination?: unknown }, index: number) => {
      const { source, destination } = it ?? {};
      const normSource = normalizeAsset(source);
      const normDest = normalizeAsset(destination);
      if (normSource === null || normDest === null) {
        return { index, ok: false as const, error: "invalid_asset_code" };
      }
      if (normSource === normDest) {
        return { index, ok: false as const, error: "same_asset" };
      }
      const key = pairKey(normSource, normDest);
      const isNew = !pairRegistry.has(key);
      pairRegistry.add(key);
      recordEvent(isNew ? "pair.registered" : "pair.refreshed", { source: normSource, destination: normDest });
      return { index, ok: true as const, source: normSource, destination: normDest, registered: true };
    }
  );
  res.json({ results });
});

/**
 * Canonicalize an asset code so that casing and surrounding whitespace never
 * fragment a logical pair.
 *
 * The input is trimmed of leading/trailing whitespace and upper-cased. After
 * normalization the code must be 1–12 characters (Stellar's max alphanumeric
 * asset code) drawn exclusively from `[A-Z0-9]` — any internal whitespace,
 * control character, or other non-alphanumeric symbol causes a rejection. The
 * reserved `__health` probe namespace is also rejected. Because the length is
 * checked *after* trimming, padding can never be used to bypass the 12-char cap.
 *
 * @param v - The raw asset code (from a body field or URL/query param).
 * @returns The canonical upper-cased code, or `null` when the input is invalid.
 */
const normalizeAsset = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const code = v.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(code) || code.startsWith("__HEALTH")) return null;
  return code;
};

// Quote amount: a base-units integer string. Parsed via BigInt so we
// never lose precision on amounts above Number.MAX_SAFE_INTEGER.
const parseAmount = (v: unknown): bigint | null => {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,38}$/.test(v)) return null;
  try {
    const n = BigInt(v);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
};

const parseSlippageBps = (v: unknown): number | null => {
  if (v === undefined) return 0;
  if (typeof v !== "string" || !/^[0-9]{1,4}$/.test(v)) return null;
  const parsed = Number(v);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : null;
};

app.post("/api/v1/quote/bulk", (req: Request, res: Response) => {
  const { items } = req.body ?? {};
  const maxItems = config.bulkMaxItems;  // driven by config.bulkMaxItems
  if (!Array.isArray(items) || items.length === 0 || items.length > maxItems) {
    sendError(res, req, 400, "invalid_request", `items must be 1-${maxItems} entries`);
    return;
  }
  /**
   * Per-item pair registration check for bulk quotes.
   *
   * When `ALLOW_UNREGISTERED_QUOTES` is not set to `"true"`, each item whose
   * pair is not present in `pairRegistry` returns `ok: false` with
   * `error: "pair_not_registered"` instead of failing the whole batch.
   * Shape/validation errors (invalid asset code, same asset, bad amount) are
   * still returned as `ok: false, error: "invalid_item"` and take precedence.
   */
  const allowUnregistered = process.env.ALLOW_UNREGISTERED_QUOTES === "true";
  const results = items.map((it: { source_asset?: unknown; dest_asset?: unknown; amount?: unknown }, i: number) => {
    const { source_asset: rawSource, dest_asset: rawDest, amount } = it ?? {};
    const source_asset = normalizeAsset(rawSource);
    const dest_asset = normalizeAsset(rawDest);
    const parsedAmount = parseAmount(amount);
    if (source_asset === null || dest_asset === null || parsedAmount === null || source_asset === dest_asset) {
      return { index: i, ok: false as const, error: "invalid_item" };
    }
    if (!allowUnregistered && !pairRegistry.has(pairKey(source_asset, dest_asset))) {
      return { index: i, ok: false as const, error: "pair_not_registered" };
    }
    const bulkKey = pairKey(source_asset, dest_asset);
    const bulkMeta = pairMeta.get(bulkKey) ?? defaultMeta();
    if (pairRegistry.has(bulkKey) && bulkMeta.enabled === false) {
      return { index: i, ok: false as const, error: "pair_disabled" };
    }
    if (pairRegistry.has(bulkKey)) {
      const boundsViolation = checkQuoteBounds(bulkMeta, parsedAmount);
      if (boundsViolation) {
        return {
          index: i,
          ok: false as const,
          error: boundsViolation.bulkError,
          message: boundsViolation.message,
        };
      }
    }
    const slippage_bps = 0;
    const priced = priceQuote(bulkMeta, parsedAmount, slippage_bps);
    return {
      index: i,
      ok: true as const,
      source_asset,
      dest_asset,
      amount: parsedAmount.toString(),
      estimated_rate: priced.rate,
      feeBps: priced.feeBps,
      feeAmount: priced.feeAmount.toString(),
      netAmount: priced.netAmount.toString(),
      slippage_bps,
      min_received: priced.minReceived.toString(),
    };
  });
  res.json({ results });
});

app.get("/api/v1/quote", (req: Request, res: Response) => {
  const { source_asset: rawSource, dest_asset: rawDest, amount, slippage_bps: rawSlippage } = req.query;

  if (!rawSource || !rawDest || !amount) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "Missing required query params: source_asset, dest_asset, amount"
    );
  }
  const source_asset = normalizeAsset(rawSource);
  const dest_asset = normalizeAsset(rawDest);
  if (source_asset === null || dest_asset === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source_asset and dest_asset must be 1-12 alphanumeric characters"
    );
  }
  if (source_asset === dest_asset) {
    return sendError(res, req, 400, "invalid_request", "source_asset and dest_asset must differ");
  }
  const parsedAmount = parseAmount(amount);
  if (parsedAmount === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "amount must be a positive integer string with no leading zero"
    );
  }
  const slippage_bps = parseSlippageBps(rawSlippage);
  if (slippage_bps === null) {
    return sendError(res, req, 400, "invalid_request", "slippage_bps must be an integer in [0,1000]");
  }

  /**
   * Pair registration guard.
   *
   * Looks up the pair key in `pairRegistry` after all shape/validation checks
   * pass. When the pair is not registered, responds 404 `pair_not_registered`
   * with the canonical `{ error, message, requestId }` body and echoes back the
   * offending `source_asset`/`dest_asset`.
   *
   * Set `ALLOW_UNREGISTERED_QUOTES=true` in the environment to bypass this check
   * (e.g. for demos that quote arbitrary pairs). The flag defaults to off, which
   * is the safe/production behavior. It can only be set at process startup and
   * cannot be toggled per-request.
   */
  const allowUnregistered = process.env.ALLOW_UNREGISTERED_QUOTES === "true";
  if (!allowUnregistered && !pairRegistry.has(pairKey(source_asset, dest_asset))) {
    return sendError(res, req, 404, "pair_not_registered",
      `pair ${source_asset}->${dest_asset} is not registered`,
      { source_asset, dest_asset }
    );
  }

  const meta = pairMeta.get(pairKey(source_asset, dest_asset)) ?? defaultMeta();
  const boundsViolation = checkQuoteBounds(meta, parsedAmount);
  if (boundsViolation) {
    return sendError(res, req, boundsViolation.status, boundsViolation.error, boundsViolation.message);
  }
  const priced = priceQuote(meta, parsedAmount, slippage_bps);

  res.json({
    source_asset,
    dest_asset,
    amount: parsedAmount.toString(),
    estimated_rate: priced.rate,
    route: [source_asset, dest_asset],
    feeBps: priced.feeBps,
    feeAmount: priced.feeAmount.toString(),
    netAmount: priced.netAmount.toString(),
    slippage_bps,
    min_received: priced.minReceived.toString(),
  });
});

app.get("/api/v1/quote/reverse", (req: Request, res: Response) => {
  const { source_asset: rawSource, dest_asset: rawDest, target_amount: rawTargetAmount } = req.query;

  if (!rawSource || !rawDest || !rawTargetAmount) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "Missing required query params: source_asset, dest_asset, target_amount"
    );
  }

  const source_asset = normalizeAsset(rawSource);
  const dest_asset = normalizeAsset(rawDest);
  if (source_asset === null || dest_asset === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source_asset and dest_asset must be 1-12 alphanumeric characters"
    );
  }

  if (source_asset === dest_asset) {
    return sendError(res, req, 400, "invalid_request", "source_asset and dest_asset must differ");
  }

  const parsedTarget = parseAmount(rawTargetAmount);
  if (parsedTarget === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "target_amount must be a positive integer string with no leading zero"
    );
  }

  const allowUnregistered = process.env.ALLOW_UNREGISTERED_QUOTES === "true";
  if (!allowUnregistered && !pairRegistry.has(pairKey(source_asset, dest_asset))) {
    return sendError(
      res,
      req,
      404,
      "pair_not_registered",
      `pair ${source_asset}->${dest_asset} is not registered`,
      { source_asset, dest_asset }
    );
  }

  const meta = pairMeta.get(pairKey(source_asset, dest_asset)) ?? defaultMeta();
  const priced = priceReverseQuote(meta, parsedTarget);

  res.json({
    source_asset,
    dest_asset,
    target_amount: parsedTarget.toString(),
    required_input: priced.requiredInput.toString(),
    estimated_rate: priced.rate,
    route: [source_asset, dest_asset],
  });
});

// Unknown route: structured 404 echoing the request id.
app.use((req: Request, res: Response) => {
  sendError(res, req, 404, "not_found", `No route for ${req.method} ${req.path}`);
});

// Final 4-arg error handler. Any handler that throws or calls next(err)
// lands here; the response shape is the same canonical
// { error, message, requestId } as the explicit 400 / 404 bodies so
// clients can branch on `error` uniformly.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.too.large") {
    sendError(res, req, 413, "payload_too_large", "request body exceeds the 100 KiB limit");
    return;
  }
  // Malformed JSON body. express.json() raises a SyntaxError tagged with
  // `type: "entity.parse.failed"`; map it to a canonical 400 client error
  // instead of letting it fall through to the generic 500. The message is
  // fixed so the raw parser text (which can echo fragments of the input) is
  // never leaked back to the caller.
  if (
    err &&
    typeof err === "object" &&
    (("type" in err && (err as { type: string }).type === "entity.parse.failed") ||
      err instanceof SyntaxError)
  ) {
    sendError(res, req, 400, "invalid_json", "request body is not valid JSON");
    return;
  }
  const isProduction = process.env.NODE_ENV === "production";
  logger.error(
    {
      err,
      requestId: getRequestId(req),
      method: req.method,
      path: req.path,
    },
    "unhandled request error"
  );
  const message = isProduction
    ? "An unexpected error occurred"
    : err instanceof Error
      ? err.message
      : "Unexpected server error";
  sendError(res, req, 500, "internal_error", message, {
    method: req.method,
    path: req.path,
  });
});

export default app;
