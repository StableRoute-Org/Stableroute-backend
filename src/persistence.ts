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
 * Data structure representing a full snapshot of the in-memory stores.
 */
export interface StoreSnapshot {
  pairRegistry: string[];
  pairMeta: [string, PairMeta][];
  apiKeyStore: [string, ApiKeyRecord][];
  webhookStore: [string, WebhookRecord][];
  eventLog: AppEvent[];
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
   * Read and parse the snapshot file.
   * Returns null if file does not exist, is unreadable, or contains invalid JSON.
   */
  load(): StoreSnapshot | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw) as unknown;
      if (this.isValidSnapshot(parsed)) {
        return parsed;
      }
      console.warn(
        "[persistence] invalid snapshot format in file:",
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

  /**
   * Basic runtime type-guard to check that parsed object matches the StoreSnapshot shape.
   */
  private isValidSnapshot(data: unknown): data is StoreSnapshot {
    if (data === null || typeof data !== "object") return false;
    const obj = data as Record<string, unknown>;
    return (
      Array.isArray(obj.pairRegistry) &&
      Array.isArray(obj.pairMeta) &&
      Array.isArray(obj.apiKeyStore) &&
      Array.isArray(obj.webhookStore) &&
      Array.isArray(obj.eventLog)
    );
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
