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

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { loadPausedState, savePausedState } from "./pauseState";
import { getStoreAdapter } from "./persistence";
import { logger } from "./logger";

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
  "pair.enabled",
  "pair.disabled",
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
  /** Base exchange rate for the pair. Defaults to "1.0". */
  rate: string;
};

/** Structured event appended to the in-memory event log. */
export type AppEvent = {
  id: string;
  ts: number;
  /** Canonical event type — always one of the values in {@link KNOWN_EVENT_TYPES}. */
  type: EventType;
  payload: Record<string, unknown>;
};

/**
 * Record stored for each generated API key.
 *
 * The raw key is never retained. Only a per-key random `salt` and the
 * resulting keyed hash (`hash`) are stored — see {@link hashApiKeySecret} and
 * {@link verifyApiKeySecret}. `apiKeyStore` is keyed by the key's non-secret
 * `prefix` (see {@link apiKeyPrefix}), not by the raw key itself, so a leaked
 * snapshot never exposes usable credentials.
 */
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
  /** Per-key random salt (hex-encoded) used to derive {@link hash}. */
  salt: string;
  /** Keyed hash of the raw key, derived via {@link hashApiKeySecret}. */
  hash: string;
};

/**
 * Number of leading characters of a raw API key used as its non-secret
 * lookup handle (the `apiKeyStore` map key, and the value returned in list /
 * delete / rotate routes as `prefix`).
 */
export const API_KEY_PREFIX_LENGTH = 8;

/** Derive the non-secret lookup prefix from a raw API key. */
export const apiKeyPrefix = (rawKey: string): string => rawKey.slice(0, API_KEY_PREFIX_LENGTH);

/** Generate a fresh random salt (hex-encoded) for hashing a new API key. */
export const generateApiKeySalt = (): string => randomBytes(16).toString("hex");

/**
 * Derive the storable hash for a raw API key, keyed by a per-record random
 * salt via HMAC-SHA256.
 *
 * API keys are high-entropy random tokens (128 bits from `randomUUID`), not
 * human-chosen secrets, so a fast keyed hash is the right tool here: unlike
 * password hashing, a slow KDF (scrypt/bcrypt/argon2) buys no meaningful
 * resistance against brute force over this input space and would add
 * needless CPU cost to every authenticated request.
 */
export const hashApiKeySecret = (rawKey: string, salt: string): string =>
  createHmac("sha256", salt).update(rawKey).digest("hex");

/**
 * Constant-time check that `rawKey` hashes to the salt/hash pair on `record`.
 *
 * Comparing with `timingSafeEqual` (rather than `===`) avoids leaking the
 * position of the first mismatched byte through response-time variance.
 */
export const verifyApiKeySecret = (
  rawKey: string,
  record: Pick<ApiKeyRecord, "salt" | "hash">
): boolean => {
  const candidate = Buffer.from(hashApiKeySecret(rawKey, record.salt), "hex");
  const stored = Buffer.from(record.hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
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
  rate: "1.0",
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

/** Get the current paused state. */
export const isPaused = (): boolean => paused;

/** Get the current read-only state. */
export const isReadOnly = (): boolean => readOnly;

// ─── Reset helper (test-only) ────────────────────────────────────────────────

/**
 * Reset every store to its initial state.
 *
 * **Call this in test `beforeEach` / `afterEach` hooks to prevent
 * cross-test bleed.** This function is never reachable via any HTTP
 * route — it exists solely for the test harness.
 */
export const resetStores = (): void => {
  // Cancel any pending debounce timer so tests start with clean persistence state.
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  const previous = isHydrating;
  isHydrating = true;
  try {
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
  } finally {
    isHydrating = previous;
  }
};

// ─── Persistence Helpers & Wrapper Logic ────────────────────────────────────

// Flag to prevent saving to disk during initial hydration or resets
export let isHydrating = false;

export const setHydrating = (value: boolean): void => {
  isHydrating = value;
};

let saveTimeout: NodeJS.Timeout | null = null;

/**
 * Serialize the current store state into a StoreSnapshot.
 */
export const getSnapshot = () => ({
  pairRegistry: Array.from(pairRegistry),
  pairMeta: Array.from(pairMeta.entries()),
  apiKeyStore: Array.from(apiKeyStore.entries()),
  webhookStore: Array.from(webhookStore.entries()),
  eventLog: [...eventLog],
});

/**
 * Hydrate the stores from a StoreSnapshot.
 */
export const hydrateFromSnapshot = (snapshot: unknown): void => {
  const previous = isHydrating;
  isHydrating = true;
  try {
    pairRegistry.clear();
    if (snapshot && typeof snapshot === "object") {
      const snap = snapshot as Record<string, unknown>;
      if (Array.isArray(snap.pairRegistry)) {
        for (const val of snap.pairRegistry) {
          if (typeof val === "string") {
            pairRegistry.add(val);
          }
        }
      }

      pairMeta.clear();
      if (Array.isArray(snap.pairMeta)) {
        for (const item of snap.pairMeta) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            pairMeta.set(item[0], item[1] as PairMeta);
          }
        }
      }

      apiKeyStore.clear();
      if (Array.isArray(snap.apiKeyStore)) {
        let invalidatedLegacyKeys = 0;
        for (const item of snap.apiKeyStore) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            const record = item[1] as Partial<ApiKeyRecord> | null;
            // Migration guard: pre-existing snapshots keyed by the raw API
            // key (with a record that predates the salt/hash fields) held
            // recoverable credential material. Rather than trust and
            // silently re-hash a value that may already have been read from
            // a leaked snapshot, drop it — the key must be recreated.
            if (!record || typeof record.salt !== "string" || typeof record.hash !== "string") {
              invalidatedLegacyKeys += 1;
              continue;
            }
            apiKeyStore.set(item[0], record as ApiKeyRecord);
          }
        }
        if (invalidatedLegacyKeys > 0) {
          logger.warn(
            { invalidatedLegacyKeys },
            "[stores] discarded pre-migration API key record(s) lacking salt/hash during snapshot hydration; affected keys must be recreated"
          );
        }
      }

      webhookStore.clear();
      if (Array.isArray(snap.webhookStore)) {
        for (const item of snap.webhookStore) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            webhookStore.set(item[0], item[1] as WebhookRecord);
          }
        }
      }

      eventLog.length = 0;
      if (Array.isArray(snap.eventLog)) {
        for (const val of snap.eventLog) {
          eventLog.push(val as AppEvent);
        }
      }
    }
  } finally {
    isHydrating = previous;
  }
};

/**
 * Triggers a debounced snapshot save to the active store adapter.
 */
export const triggerSnapshot = (): void => {
  if (isHydrating) return;
  // If running in test environment and PERSIST_PATH is unset, skip persistence
  if (process.env.NODE_ENV === "test" && !process.env.PERSIST_PATH) {
    return;
  }

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    saveSnapshotImmediately().catch((err) => {
      console.error("[stores] failed to save snapshot:", err);
    });
  }, 100);
  // Do not keep the event loop alive if the process is otherwise idle
  // (e.g. after Jest tests finish). The save will still run if the
  // process is still active.
  saveTimeout.unref();
};

/**
 * Force an immediate save of the snapshot without debouncing.
 */
export const saveSnapshotImmediately = async (): Promise<void> => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  const adapter = getStoreAdapter();
  const snapshot = getSnapshot();
  await adapter.save(snapshot);
};

// Wrap Set methods
const wrapSet = <T>(set: Set<T>) => {
  const originalAdd = set.add.bind(set) as (value: T) => Set<T>;
  set.add = function (value: T) {
    const res = originalAdd(value);
    triggerSnapshot();
    return res;
  };
  const originalDelete = set.delete.bind(set) as (value: T) => boolean;
  set.delete = function (value: T) {
    const res = originalDelete(value);
    triggerSnapshot();
    return res;
  };
  const originalClear = set.clear.bind(set) as () => void;
  set.clear = function () {
    originalClear();
    triggerSnapshot();
  };
};

// Wrap Map methods
const wrapMap = <K, V>(map: Map<K, V>) => {
  const originalSet = map.set.bind(map) as (key: K, value: V) => Map<K, V>;
  map.set = function (key: K, value: V) {
    const res = originalSet(key, value);
    triggerSnapshot();
    return res;
  };
  const originalDelete = map.delete.bind(map) as (key: K) => boolean;
  map.delete = function (key: K) {
    const res = originalDelete(key);
    triggerSnapshot();
    return res;
  };
  const originalClear = map.clear.bind(map) as () => void;
  map.clear = function () {
    originalClear();
    triggerSnapshot();
  };
};

// Wrap Array methods
const wrapArray = <T>(arr: T[]) => {
  const originalPush = arr.push.bind(arr) as (...items: T[]) => number;
  arr.push = function (...items: T[]) {
    const res = originalPush(...items);
    triggerSnapshot();
    return res;
  };
  const originalShift = arr.shift.bind(arr) as () => T | undefined;
  arr.shift = function () {
    const res = originalShift();
    triggerSnapshot();
    return res;
  };
  // Cast to a unified signature that accepts optional deleteCount to avoid
  // TypeScript overload-resolution issues when forwarding via .call().
  const originalSplice = arr.splice.bind(arr) as (
    start: number,
    deleteCount?: number,
    ...items: T[]
  ) => T[];
  arr.splice = function (start: number, deleteCount?: number, ...items: T[]) {
    const res =
      deleteCount === undefined
        ? originalSplice(start)
        : originalSplice(start, deleteCount, ...items);
    triggerSnapshot();
    return res;
  };
};

wrapSet(pairRegistry);
wrapMap(pairMeta);
wrapMap(apiKeyStore);
wrapMap(webhookStore);
wrapArray(eventLog);

