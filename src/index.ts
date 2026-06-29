import { createHash, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { openApiSpec } from "./openapi";
import {
  pairRegistry,
  pairMeta,
  apiKeyStore,
  webhookStore,
  eventLog,
  rateBuckets,
  config,
  setPaused,
  pairKey,
  defaultMeta,
  recordEvent,
  EVENT_LOG_CAP,
  WEBHOOK_MAX_EVENTS,
  WEBHOOK_MAX_EVENT_LENGTH,
  WEBHOOK_RESERVED_PREFIXES,
  type PairMeta,
  type AppEvent,
  type ApiKeyRecord,
  type WebhookRecord,
} from "./stores";
import { paused } from "./stores";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());

type RequestWithId = Request & { id?: string };
type ErrorResponseExtra = Record<string, unknown>;

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
  error: string,
  message: string,
  extra: ErrorResponseExtra = {}
) => res.status(status).json({ error, message, ...extra, requestId: getRequestId(req) });

// Attach an X-Request-Id before body parsing so parser errors can still
// return the canonical error shape with a correlation id.
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("x-request-id");
  const id = incoming && incoming.length <= 200 ? incoming : randomUUID();
  (req as RequestWithId).id = id;
  res.setHeader("X-Request-Id", id);
  next();
});

app.use(express.json({ limit: "100kb" }));

// Pause guard: refuses non-idempotent methods with 503 except
// /admin/unpause, so an operator can always recover.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!paused) return next();
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  if (req.path === "/api/v1/admin/unpause") return next();
  sendError(res, req, 503, "service_paused", "StableRoute backend is paused");
});

// Absolute ceiling for the bulkMaxItems config knob.
const BULK_ABSOLUTE_MAX = 10_000;

// Per-IP sliding-window rate limiter: 60 requests per 60 second window.
// Disabled in test mode so the test suite can make many requests without
// hitting the limit.
const RATE_LIMIT_PER_WINDOW = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Hard upper bound for the bulkMaxItems config key. */
const BULK_ABSOLUTE_MAX = 100_000;
app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "test") return next();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const bucket = (rateBuckets.get(ip) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (bucket.length >= RATE_LIMIT_PER_WINDOW) {
    res.setHeader("Retry-After", "60");
    sendError(
      res,
      req,
      429,
      "rate_limited",
      `more than ${RATE_LIMIT_PER_WINDOW} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s`
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
    if (process.env.NODE_ENV !== "test") {
      console.log(
        JSON.stringify({
          requestId: getRequestId(req),
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(ms * 10) / 10,
        })
      );
    }
  });
  next();
});

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
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
  const storageStart = Date.now();
  try {
    const testKey = `__health_${storageStart}_${Math.random()}`;
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
  const status = paused ? "paused" : degraded ? "degraded" : "ok";

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
app.post("/api/v1/admin/pause", (_req: Request, res: Response) => {
  setPaused(true);
  res.json({ paused });
});
app.post("/api/v1/admin/unpause", (_req: Request, res: Response) => {
  setPaused(false);
  res.json({ paused });
});

app.get("/api/v1/events", (req: Request, res: Response) => {
  const since = Number(req.query.since ?? 0);
  const limit = Math.min(EVENT_LOG_CAP, Math.max(1, Number(req.query.limit ?? 100)));
  const items = eventLog.filter((e) => e.ts >= since).slice(-limit);
  res.json({ items });
});

app.delete("/api/v1/api-keys/:prefix", (req: Request, res: Response) => {
  const { prefix } = req.params;
  let found: string | undefined;
  for (const k of apiKeyStore.keys()) if (k.slice(0, 8) === prefix) { found = k; break; }
  if (!found) {
    sendError(res, req, 404, "not_found", `no key with prefix ${prefix}`);
    return;
  }
  apiKeyStore.delete(found);
  res.status(204).send();
});

app.get("/api/v1/api-keys", (_req: Request, res: Response) => {
  const items = Array.from(apiKeyStore.entries()).map(([k, m]) => ({
    prefix: k.slice(0, 8),
    label: m.label,
    createdAt: m.createdAt,
  }));
  res.json({ items });
});

app.post("/api/v1/api-keys", (req: Request, res: Response) => {
  const { label } = req.body ?? {};
  if (typeof label !== "string" || label.length === 0 || label.length > 64) {
    sendError(res, req, 400, "invalid_request", "label must be 1-64 chars");
    return;
  }
  const key = `srk_${randomUUID().replace(/-/g, "")}`;
  apiKeyStore.set(key, { label, createdAt: Date.now() });
  res.status(201).json({ key, label });
});

app.delete("/api/v1/webhooks/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!webhookStore.has(id)) {
    sendError(res, req, 404, "not_found", `webhook ${id} not found`);
    return;
  }
  webhookStore.delete(id);
  res.status(204).send();
});

app.get("/api/v1/webhooks", (_req: Request, res: Response) => {
  const items = Array.from(webhookStore.entries()).map(([id, m]) => ({ id, ...m }));
  res.json({ items });
});

app.post("/api/v1/webhooks", (req: Request, res: Response) => {
  const { url, events } = req.body ?? {};
  if (typeof url !== "string" || !/^https?:\/\//.test(url) || url.length > 2048) {
    sendError(res, req, 400, "invalid_request", "url must be http(s), <=2048 chars");
    return;
  }
  if (!Array.isArray(events) || events.length === 0 || events.some((e) => typeof e !== "string")) {
    sendError(res, req, 400, "invalid_request", "events must be a non-empty string array");
    return;
  }
  if (events.length > WEBHOOK_MAX_EVENTS) {
    sendError(res, req, 400, "invalid_request", `events may contain at most ${WEBHOOK_MAX_EVENTS} entries`);
    return;
  }
  for (const name of events as string[]) {
    if (name.trim().length === 0) {
      sendError(res, req, 400, "invalid_request", "event names must not be blank or whitespace-only");
      return;
    }
    if (name.length > WEBHOOK_MAX_EVENT_LENGTH) {
      sendError(res, req, 400, "invalid_request", `event names must be <= ${WEBHOOK_MAX_EVENT_LENGTH} chars`);
      return;
    }
    if (WEBHOOK_RESERVED_PREFIXES.some((p) => name.startsWith(p))) {
      sendError(res, req, 400, "invalid_request", `event name "${name}" uses a reserved prefix`);
      return;
    }
  }
  // Deduplicate event names before storing
  const deduped = [...new Set(events as string[])];
  const id = `wh_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  webhookStore.set(id, { url, events: deduped, createdAt: Date.now() });
  res.status(201).json({ id, url, events: deduped });
});

/** Aggregate read of every per-pair slot in one round-trip. */
app.get("/api/v1/pairs/:source/:destination/info", (req: Request, res: Response) => {
  const { source, destination } = req.params;
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
  errorMessage: string
) =>
  (req: Request, res: Response): void => {
    const { source, destination } = req.params;
    const k = pairKey(source, destination);
    if (!pairRegistry.has(k)) {
      sendError(res, req, 404, "not_found", "pair not registered");
      return;
    }
    const value = (req.body ?? {})[bodyKey] as unknown;
    if (!validate(value)) {
      sendError(res, req, 400, "invalid_request", errorMessage);
      return;
    }
    const meta = pairMeta.get(k) ?? defaultMeta();
    (meta as Record<string, unknown>)[field] = value;
    pairMeta.set(k, meta);
    res.json({ source, destination, ...meta });
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
}> = [
  {
    suffix: "liquidity",
    field: "liquidity",
    bodyKey: "liquidity",
    validate: (v) => typeof v === "string" && /^[0-9]{1,39}$/.test(v),
    errorMessage: "liquidity must be a non-negative integer string",
  },
  {
    suffix: "max",
    field: "maxAmount",
    bodyKey: "maxAmount",
    validate: (v) => typeof v === "string" && /^[1-9][0-9]{0,38}$/.test(v),
    errorMessage: "maxAmount must be a positive integer string",
  },
  {
    suffix: "min",
    field: "minAmount",
    bodyKey: "minAmount",
    validate: (v) => typeof v === "string" && /^[0-9]{1,39}$/.test(v),
    errorMessage: "minAmount must be a non-negative integer string",
  },
  {
    suffix: "fee_bps",
    field: "feeBps",
    bodyKey: "feeBps",
    validate: (v) =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000,
    errorMessage: "feeBps must be an integer in [0,1000]",
  },
];

// Register each descriptor as a PATCH route.
for (const { suffix, field, bodyKey, validate, errorMessage } of pairMetaPatchDescriptors) {
  app.patch(
    `/api/v1/pairs/:source/:destination/${suffix}`,
    makePairMetaPatch(field, bodyKey, validate, errorMessage)
  );
}

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
  res.json({ paused });
});

/** Absolute upper bound on the bulkMaxItems config field. */
const BULK_ABSOLUTE_MAX = 10_000;

app.get("/api/v1/config", (_req: Request, res: Response) => res.json({ config }));
app.patch("/api/v1/config", (req: Request, res: Response) => {
  const allowed = ["rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems"] as const;
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
      config[k] = v;
    }
  }
  res.json({ config });
});

/**
 * Canonical set of known event types emitted by the gateway.
 * Kept here so the metrics series set is stable across scrapes even when
 * the event log is empty.
 */
const KNOWN_EVENT_TYPES = [
  "pair.registered",
  "pair.refreshed",
  "pair.unregistered",
] as const;

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

app.get("/api/v1/metrics", (_req: Request, res: Response) => {
  const eventCounts = aggregateEventCounts(eventLog);

  const lines = [
    "# HELP stableroute_pairs_total Number of registered pairs.",
    "# TYPE stableroute_pairs_total gauge",
    `stableroute_pairs_total ${pairRegistry.size}`,
    "# HELP stableroute_paused 1 if paused, 0 otherwise.",
    "# TYPE stableroute_paused gauge",
    `stableroute_paused ${paused ? 1 : 0}`,
    "# HELP stableroute_events_total Total number of events in the audit log.",
    "# TYPE stableroute_events_total gauge",
    `stableroute_events_total ${eventLog.length}`,
    "# HELP stableroute_events_by_type Count of events in the audit log per type.",
    "# TYPE stableroute_events_by_type gauge",
    ...Array.from(eventCounts.entries()).map(
      ([type, count]) =>
        `stableroute_events_by_type{type="${escapeLabelValue(type)}"} ${count}`
    ),
  ];
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(lines.join("\n") + "\n");
});

app.get("/api/v1/stats", (_req: Request, res: Response) => {
  res.json({
    totalPairs: pairRegistry.size,
    paused,
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
 * List every registered (source, destination) pair.
 * Response: { pairs: [{ source, destination }, ...] }
 */
app.get("/api/v1/pairs", (req: Request, res: Response) => {
  const pairs = Array.from(pairRegistry).map((k) => {
    const [source, destination] = k.split("::");
    return { source, destination };
  });
  const body = JSON.stringify({ pairs });
  const etag = `W/"${createHash("sha1").update(body).digest("base64").slice(0, 16)}"`;
  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }
  res.setHeader("ETag", etag);
  res.type("application/json").send(body);
});

/**
 * Register a pair (test-only / operator surface; will move behind an
 * admin auth guard once the gateway lands). Body: { source, destination }.
 * Returns 201 on first-write, 200 on idempotent re-write.
 */
app.post("/api/v1/pairs", (req: Request, res: Response) => {
  const { source, destination } = req.body ?? {};
  if (!isAssetCode(source) || !isAssetCode(destination)) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source and destination must be 1-12 character strings"
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

// Asset symbols are short uppercase identifiers (USDC, EURC, XLM, …).
// Cap at 12 chars (Stellar's max alphanumeric asset code) and reject
// anything that is not a single string so an array param can't smuggle
// through as a "truthy" value.
const isAssetCode = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 12;

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

app.post("/api/v1/quote/bulk", (req: Request, res: Response) => {
  const { items } = req.body ?? {};
  const maxItems = config.bulkMaxItems;  // driven by config.bulkMaxItems
  if (!Array.isArray(items) || items.length === 0 || items.length > maxItems) {
    sendError(res, req, 400, "invalid_request", `items must be 1-${maxItems} entries`);
    return;
  }
  const results = items.map((it: { source_asset?: unknown; dest_asset?: unknown; amount?: unknown }, i: number) => {
    const { source_asset, dest_asset, amount } = it ?? {};
    if (!isAssetCode(source_asset) || !isAssetCode(dest_asset) || parseAmount(amount) === null || source_asset === dest_asset) {
      return { index: i, ok: false, error: "invalid_item" };
    }
    return {
      index: i,
      ok: true,
      source_asset,
      dest_asset,
      amount: String(amount),
      estimated_rate: "1.0",
    };
  });
  res.json({ results });
});

app.get("/api/v1/quote", (req: Request, res: Response) => {
  const { source_asset, dest_asset, amount } = req.query;

  if (!source_asset || !dest_asset || !amount) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "Missing required query params: source_asset, dest_asset, amount"
    );
  }
  if (!isAssetCode(source_asset) || !isAssetCode(dest_asset)) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source_asset and dest_asset must be 1-12 character strings"
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

  res.json({
    source_asset,
    dest_asset,
    amount: parsedAmount.toString(),
    estimated_rate: "1.0",
    route: [source_asset, dest_asset],
  });
});

/**
 * Invert the fee formula to solve for the gross input required to deliver
 * exactly `output` base units after the gateway fee is deducted.
 *
 * The forward fee formula is:
 *   fee    = floor(gross * feeBps / 10_000)
 *   output = gross - fee
 *
 * Rearranging:
 *   gross  = ceil(output * 10_000 / (10_000 - feeBps))
 *
 * The result is rounded **up** (ceiling division) so that applying the
 * forward fee to `requiredInput` always yields at least `output` — the
 * recipient is never short-changed.
 *
 * @param output  - Target delivered amount in base units (must be > 0).
 * @param feeBps  - Fee in basis points in [0, 10000).
 * @returns Object with `requiredInput` (gross, rounded up) and `feeAmount`.
 * @throws {RangeError} if feeBps >= 10000 (100% fee leaves nothing to deliver).
 */
export const invertFee = (
  output: bigint,
  feeBps: number
): { requiredInput: bigint; feeAmount: bigint } => {
  if (feeBps < 0 || feeBps >= 10_000) {
    throw new RangeError("feeBps must be in [0, 9999]");
  }
  const denominator = BigInt(10_000 - feeBps);
  const numerator = output * 10_000n;
  // Ceiling division: (a + b - 1) / b
  const requiredInput = (numerator + denominator - 1n) / denominator;
  const feeAmount = requiredInput - output;
  return { requiredInput, feeAmount };
};

app.get("/api/v1/quote/reverse", (req: Request, res: Response) => {
  const { source_asset, dest_asset, output } = req.query;

  if (!source_asset || !dest_asset || !output) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "Missing required query params: source_asset, dest_asset, output"
    );
  }
  if (!isAssetCode(source_asset) || !isAssetCode(dest_asset)) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "source_asset and dest_asset must be 1-12 character strings"
    );
  }
  if (source_asset === dest_asset) {
    return sendError(res, req, 400, "invalid_request", "source_asset and dest_asset must differ");
  }
  const parsedOutput = parseAmount(output);
  if (parsedOutput === null) {
    return sendError(
      res,
      req,
      400,
      "invalid_request",
      "output must be a positive integer string with no leading zero"
    );
  }

  const k = pairKey(source_asset, dest_asset);
  const meta = pairMeta.get(k) ?? defaultMeta();
  const feeBps = meta.feeBps;

  const { requiredInput, feeAmount } = invertFee(parsedOutput, feeBps);

  res.json({
    source_asset,
    dest_asset,
    output: parsedOutput.toString(),
    requiredInput: requiredInput.toString(),
    feeAmount: feeAmount.toString(),
    feeBps,
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
  const message =
    err instanceof Error ? err.message : "Unexpected server error";
  sendError(res, req, 500, "internal_error", message, {
    method: req.method,
    path: req.path,
  });
});

export default app;
