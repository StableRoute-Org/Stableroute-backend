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

// ─── Types ───────────────────────────────────────────────────────────────────

/** Per-pair metadata mirroring DataKey::PairFeeBps / Min / Max / Liquidity. */
export type PairMeta = {
  feeBps: number;
  minAmount: string;
  maxAmount: string;
  liquidity: string;
};

/** Structured event appended to the in-memory event log. */
export type AppEvent = {
  id: string;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};

/** Record stored for each generated API key. */
export type ApiKeyRecord = {
  label: string;
  createdAt: number;
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
});

/** Canonical config shape used by GET/PATCH /api/v1/config. */
const defaultConfig = (): Record<string, number> => ({
  rateLimitPerWindow: 60,
  rateLimitWindowMs: 60_000,
  bulkMaxItems: 100,
  eventLogCap: EVENT_LOG_CAP,
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
 */
export let paused = false;

// ─── Accessors ───────────────────────────────────────────────────────────────

/**
 * Derive the canonical pair-key from source and destination asset codes.
 *
 * @example pairKey("USDC", "EURC") // → "USDC::EURC"
 */
export const pairKey = (source: string, dest: string): string =>
  `${source}::${dest}`;

/**
 * Resolve the effective event-log cap from the live runtime config.
 *
 * The config value takes precedence when it is a positive integer within the
 * allowed range. Falls back to {@link EVENT_LOG_CAP} if the config value is
 * absent, non-integer, zero, or above {@link EVENT_LOG_CAP_MAX}.
 */
export const effectiveEventLogCap = (): number => {
  const v = config.eventLogCap;
  if (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= EVENT_LOG_CAP_MAX) {
    return v;
  }
  return EVENT_LOG_CAP;
};

/**
 * Trim `eventLog` down to `cap` entries, removing the oldest first.
 * No-op when the log is already within the cap.
 */
export const trimEventLog = (cap: number): void => {
  const excess = eventLog.length - cap;
  if (excess > 0) eventLog.splice(0, excess);
};

/**
 * Append an event to the bounded event log, evicting the oldest entry when
 * the log exceeds the effective cap sourced from `config.eventLogCap`.
 *
 * The effective cap is resolved at write time so that operators who lower
 * `eventLogCap` via PATCH /api/v1/config see the tighter bound applied
 * immediately on the next write. Use {@link trimEventLog} to shrink the
 * existing buffer proactively after a cap change.
 *
 * @param type    - Dot-namespaced event type string (e.g. `"pair.registered"`).
 * @param payload - Arbitrary key/value metadata attached to the event.
 */
export const recordEvent = (
  type: string,
  payload: Record<string, unknown>
): void => {
  eventLog.push({ id: randomUUID(), ts: Date.now(), type, payload });
  const cap = effectiveEventLogCap();
  if (eventLog.length > cap) eventLog.shift();
};

/**
 * Set the paused flag. Exported as a function so index.ts can mutate it
 * without reassigning the binding (which would require `export let` in
 * the caller).
 */
export const setPaused = (value: boolean): void => {
  paused = value;
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
};
