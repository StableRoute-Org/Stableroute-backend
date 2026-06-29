/**
 * Centralised in-memory state for the StableRoute backend.
 *
 * Every mutable collection and scalar lives here so that:
 * - tests can import and reset state between runs via {@link resetStores}
 * - route handlers stay in `src/index.ts` and consume the stores
 *   through the typed accessors exported below
 *
 * @module stores
 */

import { randomUUID } from "node:crypto";
import { loadPausedState, savePausedState } from "./pauseState";

// ─── Event types ─────────────────────────────────────────────────────────────

/**
 * Exhaustive list of canonical event type names emitted by the StableRoute
 * backend. Adding a new event type here automatically widens {@link EventType}
 * and makes `recordEvent` callers type-checked against the new value.
 */
export const KNOWN_EVENT_TYPES = [
  "pair.registered",
  "pair.refreshed",
  "pair.unregistered",
  "pair.meta.reset",
  "apikey.created",
  "apikey.deleted",
  "webhook.created",
  "webhook.deleted",
  "admin.paused",
  "admin.unpaused",
] as const;

/**
 * Union of all recognised event type names derived from {@link KNOWN_EVENT_TYPES}.
 * Using a const-asserted tuple ensures the union stays in sync with the
 * allowlist without any manual duplication.
 *
 * @example
 * const t: EventType = "pair.registered"; // OK
 * const bad: EventType = "unknown.event"; // TypeScript error
 */
export type EventType = (typeof KNOWN_EVENT_TYPES)[number];

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-pair metadata mirroring DataKey::PairFeeBps / Min / Max / Liquidity. */
export type PairMeta = {
  feeBps: number;
  minAmount: string;
  maxAmount: string;
  liquidity: string;
  /** Whether this pair is enabled for quoting. Default true. */
  enabled: boolean;
};

/** Structured event appended to the in-memory event log. */
export type AppEvent = {
  id: string;
  ts: number;
  /** Canonical event type — always one of the values in {@link KNOWN_EVENT_TYPES}. */
  type: EventType;
  payload: Record<string, unknown>;
};

/** Record stored for each generated API key. */
export type ApiKeyRecord = {
  label: string;
  createdAt: number;
  /** Granted authorization scopes; empty array means read-only. Defaults to [] if omitted. */
  scopes?: string[];
  /**
   * Epoch-ms timestamp at which this key was rotated and replaced by a
   * successor. Absent on keys that have not been rotated.
   */
  rotatedAt?: number;
  /**
   * Absolute epoch-ms deadline after which a rotated (predecessor) key is
   * considered invalid. Both predecessor and successor remain valid until
   * this deadline, giving callers an overlap window. Absent until rotation.
   */
  graceExpiresAt?: number;
  /** Epoch-ms when key expires; absent = never expires. */
  expiresAt?: number;
  /** Epoch-ms of last successful authentication; absent until first use. */
  lastUsedAt?: number;
};

/** Record stored for each registered webhook. */
export type WebhookRecord = {
  url: string;
  events: string[];
  createdAt: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

/** Hard cap on event-log size; oldest entries are evicted beyond this. */
export const EVENT_LOG_CAP = 10_000;

/**
 * Sentinel key used by the deep-health storage probe.
 * Prefixed with a NUL control character so it can never collide with a real
 * pair key entered by an operator (which must start with `[A-Z0-9]`).
 */
export const HEALTH_PROBE_KEY = "\x00__health_probe__";

/**
 * Maximum number of IPs tracked in the rate-bucket map at once.
 * Entries beyond this limit are pruned (oldest first) to bound memory use.
 */
export const RATE_BUCKETS_MAX_IPS = 10_000;

/**
 * Absolute maximum value accepted for `eventLogCap` in PATCH /api/v1/config.
 * Prevents malicious or accidental unbounded memory allocation.
 */
export const EVENT_LOG_CAP_MAX = 1_000_000;

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Fresh pair-meta with all fields zeroed. */
export const defaultMeta = (): PairMeta => ({
  feeBps: 0,
  minAmount: "0",
  maxAmount: "0",
  liquidity: "0",
  enabled: true,
});

/** Canonical config shape used by GET/PATCH /api/v1/config. */
const defaultConfig = (): Record<string, number> => ({
  rateLimitPerWindow: 60,
  rateLimitWindowMs: 60_000,
  bulkMaxItems: 100,
  eventLogCap: EVENT_LOG_CAP,
  quote_ttl_ms: 30_000,
});

// ─── Stores ──────────────────────────────────────────────────────────────────

/**
 * Set of registered pair keys (`"SOURCE::DEST"`).
 *
 * In-memory mirror of the on-chain DataKey::Pair(source, dest) set.
 * Process restart resets the map; persistence lands with the database adapter.
 */
export const pairRegistry = new Set<string>();

/** Per-pair fee / amount / liquidity metadata keyed by {@link pairKey}. */
export const pairMeta = new Map<string, PairMeta>();

/** Generated API key records keyed by full key string. */
export const apiKeyStore = new Map<string, ApiKeyRecord>();

/** Registered webhook records keyed by webhook id. */
export const webhookStore = new Map<string, WebhookRecord>();

/** Bounded ring-buffer of application events. */
export const eventLog: AppEvent[] = [];

/** Per-IP sliding-window timestamps for the rate limiter. */
export const rateBuckets = new Map<string, number[]>();

/**
 * Mutable runtime config exposed by GET/PATCH /api/v1/config.
 * Operators can tune rate limits and bulk caps at runtime.
 */
export const config: Record<string, number> = defaultConfig();

/**
 * Service-level pause flag. When `true` the pause-guard middleware rejects
 * non-idempotent requests with 503.
 *
 * Initialised from durable storage at module load so that the state
 * survives process restarts. In the `test` environment the flag always
 * starts as `false` so individual test files remain isolated. Mutate
 * exclusively via {@link setPaused}.
 */
export let paused = process.env.NODE_ENV === "test" ? false : loadPausedState();

/**
 * Read-only maintenance flag. When `true` (and not {@link paused}), the
 * read-only guard middleware keeps reads and quotes flowing while rejecting
 * other mutating writes with `503 read_only_mode`. Strictly weaker than
 * `paused`: when paused, the pause behavior wins.
 */
export let readOnly = false;

// ─── Accessors ───────────────────────────────────────────────────────────────

/**
 * Derive the canonical pair-key from source and destination asset codes.
 *
 * @example pairKey("USDC", "EURC") // → "USDC::EURC"
 */
export const pairKey = (source: string, dest: string): string =>
  `${source}::${dest}`;

/**
 * Return the active event-log capacity: uses `config.eventLogCap` when set
 * and within valid bounds `(0, EVENT_LOG_CAP_MAX]`, otherwise falls back to
 * {@link EVENT_LOG_CAP}.
 */
export const effectiveEventLogCap = (): number => {
  const cap = config.eventLogCap;
  if (typeof cap !== "number" || cap <= 0 || cap > EVENT_LOG_CAP_MAX) return EVENT_LOG_CAP;
  return cap;
};

/**
 * Trim the event log to at most `cap` entries, removing the oldest entries first.
 * Used by PATCH /api/v1/config when `eventLogCap` is lowered.
 */
export const trimEventLog = (cap: number): void => {
  while (eventLog.length > cap) eventLog.shift();
};

/**
 * Append an event to the bounded event log, evicting the oldest entry
 * when the log exceeds the effective cap.
 *
 * @param type - Must be one of the canonical {@link EventType} values; TypeScript
 *   enforces this at the call site so stray string literals are caught at compile time.
 * @param payload - Arbitrary structured data attached to the event.
 */
export const recordEvent = (
  type: EventType,
  payload: Record<string, unknown>
): void => {
  eventLog.push({ id: randomUUID(), ts: Date.now(), type, payload });
  const cap = effectiveEventLogCap();
  if (eventLog.length > cap) eventLog.shift();
};

/**
 * Set the paused flag and persist it to durable storage so the state
 * survives process restarts.
 *
 * Exported as a function so `index.ts` can mutate the module-level
 * binding without a direct reassignment (which would be a TS error on
 * an imported `let`). The persistence write is best-effort: I/O
 * failures are logged but never propagated, so in-process state always
 * takes effect even when the filesystem is unavailable.
 *
 * @param value - The new pause state to apply and persist.
 */
export const setPaused = (value: boolean): void => {
  paused = value;
  savePausedState(value);
};

/**
 * Set the read-only flag. Exported as a function so index.ts can mutate it
 * without reassigning the binding.
 */
export const setReadOnly = (value: boolean): void => {
  readOnly = value;
};

// ─── Reset helper (test-only) ────────────────────────────────────────────────

/**
 * Reset every store to its initial state.
 *
 * **Call this in test `beforeEach` / `afterEach` hooks to prevent
 * cross-test bleed.** This function is never reachable via any HTTP
 * route — it exists solely for the test harness.
 */
export const resetStores = (): void => {
  pairRegistry.clear();
  pairMeta.clear();
  apiKeyStore.clear();
  webhookStore.clear();
  eventLog.length = 0;
  rateBuckets.clear();
  // Restore config to factory defaults
  const defs = defaultConfig();
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, defs);
  paused = false;
  readOnly = false;
  // Clean up any persisted pause-state file so test isolation is complete.
  savePausedState(false);
};
