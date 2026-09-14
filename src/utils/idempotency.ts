import { createHash, randomUUID } from "node:crypto";

export interface IdempotencyRecord {
  key: string;
  method: string;
  path: string;
  bodyHash: string;
  status: number;
  body: unknown;
  createdAt: number;
  expiresAt: number;
}

export class IdempotencyStore {
  private store = new Map<string, IdempotencyRecord>();

  constructor(private ttlMs: number = 24 * 60 * 60 * 1000, private maxSize: number = 10000) {}

  get(key: string): IdempotencyRecord | undefined {
    const record = this.store.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return record;
  }

  set(record: IdempotencyRecord): void {
    this.prune();
    this.store.set(record.key, record);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, record] of this.store) {
      if (record.expiresAt <= now) this.store.delete(key);
    }
    while (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
      else break;
    }
  }

  static buildKey(method: string, path: string, idempotencyKey: string): string {
    return `${method}:${path}:${idempotencyKey}`;
  }

  static hashBody(body: unknown): string {
    return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
  }

  static generateKey(): string {
    return randomUUID();
  }
}

// Global singleton
export const idempotencyStore = new IdempotencyStore();

export function resetIdempotencyStore(): void {
  idempotencyStore.clear();
}
