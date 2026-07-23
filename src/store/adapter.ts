/**
 * Pluggable storage adapter interface for StableRoute backend.
 *
 * All persistent state — pairs, pair metadata, API keys, webhooks, and events —
 * is accessed through this interface so the backing store can be swapped without
 * touching handler logic.
 *
 * The active adapter is selected by the `STORAGE_BACKEND` environment variable:
 * - `"memory"` (default) — in-process `Map`/`Set`; state is lost on restart.
 * - `"json-file"` — JSON file at the path given by `STORAGE_FILE` (default
 *   `./stableroute-data.json`); state survives restarts.
 *
 * @module store/adapter
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import type {
  PairMeta,
  AppEvent,
  ApiKeyRecord,
  WebhookRecord,
} from "../stores";

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Storage adapter interface covering all five persistent collections.
 *
 * Implementations must be synchronous: the existing HTTP handlers are
 * synchronous and introducing async would require a larger refactor.
 */
export interface StorageAdapter {
  // ── Pairs ──────────────────────────────────────────────────────────────────
  /** Return all registered pair keys. */
  pairsAll(): Set<string>;
  /** Return `true` when the pair key is registered. */
  pairsHas(key: string): boolean;
  /** Register (or re-register) a pair key. */
  pairsAdd(key: string): void;
  /** Remove a pair key. Returns `true` when it existed. */
  pairsDelete(key: string): boolean;
  /** Total number of registered pairs. */
  pairsSize(): number;

  // ── Pair metadata ──────────────────────────────────────────────────────────
  /** Retrieve metadata for a pair key, or `undefined` if absent. */
  metaGet(key: string): PairMeta | undefined;
  /** Store metadata for a pair key. */
  metaSet(key: string, meta: PairMeta): void;
  /** Remove metadata for a pair key. Returns `true` when it existed. */
  metaDelete(key: string): boolean;

  // ── API keys ───────────────────────────────────────────────────────────────
  /** Return all stored [key, record] entries. */
  keysAll(): Map<string, ApiKeyRecord>;
  /** Retrieve a key record, or `undefined` if absent. */
  keysGet(key: string): ApiKeyRecord | undefined;
  /** Store a key record. */
  keysSet(key: string, record: ApiKeyRecord): void;
  /** Remove a key record. Returns `true` when it existed. */
  keysDelete(key: string): boolean;
  /** Total number of stored keys. */
  keysSize(): number;

  // ── Webhooks ───────────────────────────────────────────────────────────────
  /** Return all stored [id, record] entries. */
  webhooksAll(): Map<string, WebhookRecord>;
  /** Retrieve a webhook record, or `undefined` if absent. */
  webhooksGet(id: string): WebhookRecord | undefined;
  /** Store a webhook record. */
  webhooksSet(id: string, record: WebhookRecord): void;
  /** Remove a webhook record. Returns `true` when it existed. */
  webhooksDelete(id: string): boolean;
  /** Total number of registered webhooks. */
  webhooksSize(): number;

  // ── Events ─────────────────────────────────────────────────────────────────
  /** Return the current event log array (live reference for in-memory; snapshot for file). */
  eventsGet(): AppEvent[];
  /** Append an event to the log. */
  eventsAppend(event: AppEvent): void;
  /** Trim the log to at most `cap` entries (keep newest). */
  eventsTrim(cap: number): void;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /** Flush any pending writes. No-op for in-memory adapters. */
  flush(): void;
  /** Clear all persisted state. Used by the test harness. */
  clear(): void;
}

// ─── In-Memory Adapter ────────────────────────────────────────────────────────

/**
 * Default in-memory adapter that mirrors the original `Map`/`Set`/`Array`
 * stores.  State is lost on process restart — identical to the previous
 * behaviour before the adapter layer was introduced.
 */
export class InMemoryAdapter implements StorageAdapter {
  private readonly pairs = new Set<string>();
  private readonly meta = new Map<string, PairMeta>();
  private readonly keys = new Map<string, ApiKeyRecord>();
  private readonly webhooks = new Map<string, WebhookRecord>();
  private readonly events: AppEvent[] = [];

  pairsAll(): Set<string> {
    return this.pairs;
  }
  pairsHas(key: string): boolean {
    return this.pairs.has(key);
  }
  pairsAdd(key: string): void {
    this.pairs.add(key);
  }
  pairsDelete(key: string): boolean {
    return this.pairs.delete(key);
  }
  pairsSize(): number {
    return this.pairs.size;
  }

  metaGet(key: string): PairMeta | undefined {
    return this.meta.get(key);
  }
  metaSet(key: string, m: PairMeta): void {
    this.meta.set(key, m);
  }
  metaDelete(key: string): boolean {
    return this.meta.delete(key);
  }

  keysAll(): Map<string, ApiKeyRecord> {
    return this.keys;
  }
  keysGet(key: string): ApiKeyRecord | undefined {
    return this.keys.get(key);
  }
  keysSet(key: string, r: ApiKeyRecord): void {
    this.keys.set(key, r);
  }
  keysDelete(key: string): boolean {
    return this.keys.delete(key);
  }
  keysSize(): number {
    return this.keys.size;
  }

  webhooksAll(): Map<string, WebhookRecord> {
    return this.webhooks;
  }
  webhooksGet(id: string): WebhookRecord | undefined {
    return this.webhooks.get(id);
  }
  webhooksSet(id: string, r: WebhookRecord): void {
    this.webhooks.set(id, r);
  }
  webhooksDelete(id: string): boolean {
    return this.webhooks.delete(id);
  }
  webhooksSize(): number {
    return this.webhooks.size;
  }

  eventsGet(): AppEvent[] {
    return this.events;
  }
  eventsAppend(event: AppEvent): void {
    this.events.push(event);
  }
  eventsTrim(cap: number): void {
    if (this.events.length > cap)
      this.events.splice(0, this.events.length - cap);
  }

  flush(): void {
    /* no-op */
  }
  clear(): void {
    this.pairs.clear();
    this.meta.clear();
    this.keys.clear();
    this.webhooks.clear();
    this.events.length = 0;
  }
}

// ─── JSON File Adapter ────────────────────────────────────────────────────────

/** Shape persisted to disk by {@link JsonFileAdapter}. */
interface PersistedStore {
  pairs: string[];
  meta: Record<string, PairMeta>;
  keys: Record<string, ApiKeyRecord>;
  webhooks: Record<string, WebhookRecord>;
  events: AppEvent[];
}

/**
 * File-backed JSON adapter.  All data is written to a single JSON file on
 * every mutation so state survives process restarts.
 *
 * Select this adapter by setting `STORAGE_BACKEND=json-file`.  The file path
 * defaults to `./stableroute-data.json` and can be overridden via
 * `STORAGE_FILE`.
 *
 * Security note: the file path is read from the environment at construction
 * time and never derived from user input, so path-traversal attacks are not
 * possible through the HTTP API.
 */
export class JsonFileAdapter implements StorageAdapter {
  private readonly filePath: string;
  private pairs: Set<string>;
  private meta: Map<string, PairMeta>;
  private keys: Map<string, ApiKeyRecord>;
  private webhooks: Map<string, WebhookRecord>;
  private events: AppEvent[];

  constructor(filePath: string) {
    this.filePath = filePath;
    const loaded = this._load();
    this.pairs = new Set(loaded.pairs);
    this.meta = new Map(Object.entries(loaded.meta));
    this.keys = new Map(Object.entries(loaded.keys));
    this.webhooks = new Map(Object.entries(loaded.webhooks));
    this.events = loaded.events;
  }

  private _load(): PersistedStore {
    if (!existsSync(this.filePath)) {
      return { pairs: [], meta: {}, keys: {}, webhooks: {}, events: [] };
    }
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedStore;
    } catch (err) {
      console.warn(
        "[store] failed to parse snapshot file, starting fresh:",
        this.filePath,
        err,
      );
      return { pairs: [], meta: {}, keys: {}, webhooks: {}, events: [] };
    }
  }

  private _save(): void {
    const tempPath = `${this.filePath}.tmp`;
    const data: PersistedStore = {
      pairs: Array.from(this.pairs),
      meta: Object.fromEntries(this.meta),
      keys: Object.fromEntries(this.keys),
      webhooks: Object.fromEntries(this.webhooks),
      events: this.events,
    };
    try {
      const fd = openSync(tempPath, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(data), { encoding: "utf8" });
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tempPath, this.filePath);
    } catch (err) {
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {}
      throw err;
    }
  }

  pairsAll(): Set<string> {
    return this.pairs;
  }
  pairsHas(key: string): boolean {
    return this.pairs.has(key);
  }
  pairsAdd(key: string): void {
    this.pairs.add(key);
    this._save();
  }
  pairsDelete(key: string): boolean {
    const r = this.pairs.delete(key);
    if (r) this._save();
    return r;
  }
  pairsSize(): number {
    return this.pairs.size;
  }

  metaGet(key: string): PairMeta | undefined {
    return this.meta.get(key);
  }
  metaSet(key: string, m: PairMeta): void {
    this.meta.set(key, m);
    this._save();
  }
  metaDelete(key: string): boolean {
    const r = this.meta.delete(key);
    if (r) this._save();
    return r;
  }

  keysAll(): Map<string, ApiKeyRecord> {
    return this.keys;
  }
  keysGet(key: string): ApiKeyRecord | undefined {
    return this.keys.get(key);
  }
  keysSet(key: string, record: ApiKeyRecord): void {
    this.keys.set(key, record);
    this._save();
  }
  keysDelete(key: string): boolean {
    const r = this.keys.delete(key);
    if (r) this._save();
    return r;
  }
  keysSize(): number {
    return this.keys.size;
  }

  webhooksAll(): Map<string, WebhookRecord> {
    return this.webhooks;
  }
  webhooksGet(id: string): WebhookRecord | undefined {
    return this.webhooks.get(id);
  }
  webhooksSet(id: string, record: WebhookRecord): void {
    this.webhooks.set(id, record);
    this._save();
  }
  webhooksDelete(id: string): boolean {
    const r = this.webhooks.delete(id);
    if (r) this._save();
    return r;
  }
  webhooksSize(): number {
    return this.webhooks.size;
  }

  eventsGet(): AppEvent[] {
    return this.events;
  }
  eventsAppend(event: AppEvent): void {
    this.events.push(event);
    this._save();
  }
  eventsTrim(cap: number): void {
    if (this.events.length > cap) {
      this.events.splice(0, this.events.length - cap);
      this._save();
    }
  }

  flush(): void {
    this._save();
  }
  clear(): void {
    this.pairs.clear();
    this.meta.clear();
    this.keys.clear();
    this.webhooks.clear();
    this.events.length = 0;
    this._save();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build the active storage adapter from environment variables.
 *
 * | `STORAGE_BACKEND` | Adapter            | Notes                                  |
 * |-------------------|--------------------|----------------------------------------|
 * | `"memory"` (default) | {@link InMemoryAdapter} | No disk I/O; state lost on restart. |
 * | `"json-file"`     | {@link JsonFileAdapter} | Durable; path from `STORAGE_FILE`. |
 *
 * @returns A ready-to-use `StorageAdapter` instance.
 */
export function createAdapter(): StorageAdapter {
  const backend = process.env.STORAGE_BACKEND ?? "memory";
  if (backend === "json-file") {
    const filePath = process.env.STORAGE_FILE ?? "./stableroute-data.json";
    return new JsonFileAdapter(filePath);
  }
  return new InMemoryAdapter();
}

/** The singleton adapter used by the application. */
export const adapter: StorageAdapter = createAdapter();
