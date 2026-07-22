import {
  writeFileSync,
  renameSync,
  readFileSync,
  existsSync,
  unlinkSync,
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
   * Write the snapshot atomically (write to temp file with 0o600 permissions, then rename).
   * I/O errors are logged and silently absorbed — the in-memory store is never affected.
   */
  save(snapshot: StoreSnapshot): void {
    const tempPath = `${this.filePath}.tmp`;
    try {
      const data = JSON.stringify(snapshot, null, 2);
      writeFileSync(tempPath, data, { encoding: "utf8", mode: 0o600 });
      renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error("[persistence] failed to save snapshot atomically:", err);
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {}
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
