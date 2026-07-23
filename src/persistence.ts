import {
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  unlinkSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import {
  type PairMeta,
  type ApiKeyRecord,
  type WebhookRecord,
  type AppEvent,
} from "./stores";

/**
 * The current schema version for persisted snapshots.
 * Increment when fields are added to {@link StoreSnapshot} so that older
 * snapshots can be upgraded via the migration chain in {@link migrateSnapshot}.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Data structure representing a full snapshot of the in-memory stores.
 */
export interface StoreSnapshot {
  /** Schema version for forward/backward compatibility. */
  schemaVersion: number;
  pairRegistry: string[];
  pairMeta: [string, PairMeta][];
  apiKeyStore: [string, ApiKeyRecord][];
  webhookStore: [string, WebhookRecord][];
  eventLog: AppEvent[];
}

// ─── Schema migration helpers ──────────────────────────────────────────────

/**
 * Runtime type-guard that checks a (migrated) object matches the StoreSnapshot shape.
 */
function isValidSnapshot(data: unknown): data is StoreSnapshot {
  if (data === null || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.schemaVersion === "number" &&
    Array.isArray(obj.pairRegistry) &&
    Array.isArray(obj.pairMeta) &&
    Array.isArray(obj.apiKeyStore) &&
    Array.isArray(obj.webhookStore) &&
    Array.isArray(obj.eventLog)
  );
}

/**
 * Run the forward-migration chain to bring a raw parsed snapshot up to
 * {@link CURRENT_SCHEMA_VERSION}.
 *
 * Returns `null` when the snapshot uses a *newer* schema version than this
 * build can handle, or when the final shape is invalid.
 */
function migrateSnapshot(data: unknown): StoreSnapshot | null {
  if (data === null || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const version =
    typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    console.warn(
      "[persistence] snapshot uses schema version",
      version,
      "which is newer than the supported version",
      CURRENT_SCHEMA_VERSION,
      "; refusing to load",
    );
    return null;
  }

  let snap = obj;

  if (version < 1) {
    snap = migrateV0ToV1(snap);
  }

  if (isValidSnapshot(snap)) {
    return snap as StoreSnapshot;
  }

  return null;
}

/**
 * Migrate a version-0 (pre-schema-versioning) snapshot to version 1.
 *
 * In version 0 the {@link PairMeta} type did not include the `enabled`
 * or `rate` fields; this migration backfills those defaults so that
 * older snapshots hydrate correctly.
 */
function migrateV0ToV1(data: Record<string, unknown>): Record<string, unknown> {
  data.schemaVersion = 1;

  if (Array.isArray(data.pairMeta)) {
    for (let i = 0; i < data.pairMeta.length; i++) {
      const entry = data.pairMeta[i];
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        entry[1] !== null &&
        typeof entry[1] === "object"
      ) {
        const meta = entry[1] as Record<string, unknown>;
        if (typeof meta.enabled !== "boolean") {
          meta.enabled = true;
        }
        if (typeof meta.rate !== "string") {
          meta.rate = "1.0";
        }
      }
    }
  }

  return data;
}

/**
 * Interface for pluggable persistence store adapters.
 */
export interface StoreAdapter {
  /**
   * Load the persisted snapshot from the adapter.
   * Returns the snapshot if present, or null if no snapshot exists or could not be loaded.
   */
  load(): Promise<StoreSnapshot | null> | StoreSnapshot | null;

  /**
   * Persist the snapshot to the adapter.
   *
   * @param snapshot - The snapshot object containing all stores.
   */
  save(snapshot: StoreSnapshot): Promise<void> | void;
}

/**
 * A no-op implementation of StoreAdapter that keeps data in memory only.
 * Primarily used in test environment or when persistence is disabled.
 */
export class InMemoryStoreAdapter implements StoreAdapter {
  load(): StoreSnapshot | null {
    return null;
  }
  save(_snapshot: StoreSnapshot): void {
    // No-op
  }
}

/**
 * A file-backed JSON implementation of StoreAdapter.
 * Writes snapshot data atomically using write-temp-then-rename.
 */
export class JsonFileStoreAdapter implements StoreAdapter {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * @param filePath - The path to the snapshot file.
   */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Read, migrate, and parse the snapshot file.
   * Returns null if file does not exist, is unreadable, contains invalid JSON,
   * uses a newer schema version, or fails migration.
   */
  load(): StoreSnapshot | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw) as unknown;
      const migrated = migrateSnapshot(parsed);
      if (migrated) {
        return migrated;
      }
      console.warn(
        "[persistence] invalid or incompatible snapshot in file:",
        this.filePath,
      );
      return null;
    } catch (err) {
      console.error("[persistence] failed to load snapshot from file:", err);
      return null;
    }
  }

  /**
   * Write the snapshot atomically (write to temp file, fsync, then rename).
   * Concurrent saves are serialized via an in-process write queue.
   */
  save(snapshot: StoreSnapshot): Promise<void> {
    return this.enqueue(() => this.writeSnapshot(snapshot));
  }

  /**
   * Enqueue a synchronous write function, returning a promise that resolves
   * after the function completes.  This serializes concurrent save requests.
   */
  private enqueue(fn: () => void): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => {
      fn();
    });
    return this.writeQueue;
  }

  /**
   * Perform the actual file write: write to a temp file, fsync, then rename
   * over the target path for an atomic replace.  Cleans up the temp file on
   * error.
   */
  private writeSnapshot(snapshot: StoreSnapshot): void {
    const tempPath = `${this.filePath}.tmp`;
    try {
      const data = JSON.stringify(snapshot, null, 2);
      const fd = openSync(tempPath, "w", 0o600);
      try {
        writeFileSync(fd, data, { encoding: "utf8" });
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error("[persistence] failed to save snapshot atomically:", err);
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {}
      throw err;
    }
  }

}

/**
 * Factory function to retrieve the appropriate StoreAdapter based on env.
 */
export function getStoreAdapter(): StoreAdapter {
  if (process.env.PERSIST_PATH) {
    return new JsonFileStoreAdapter(process.env.PERSIST_PATH);
  }
  return new InMemoryStoreAdapter();
}
