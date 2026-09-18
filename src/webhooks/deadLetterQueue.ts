/**
 * In-memory Dead-Letter Queue (DLQ) for failed webhook deliveries.
 *
 * Captures events that exhausted all delivery attempts, providing
 * observability and safe manual/programmatic replay.
 *
 * @module webhooks/deadLetterQueue
 */

import { randomUUID } from "node:crypto";
import type { DeadLetterRecord, DeadLetterFilter } from "./types";

export const DEFAULT_DLQ_CAP = 1_000;

export class DeadLetterQueueStore {
  private readonly store = new Map<string, DeadLetterRecord>();

  constructor(private readonly cap: number = DEFAULT_DLQ_CAP) {}

  /**
   * Enqueue a failed delivery into the dead-letter queue.
   */
  enqueue(
    item: Omit<DeadLetterRecord, "id" | "createdAt" | "lastAttemptAt"> & {
      lastAttemptAt?: number;
    },
  ): DeadLetterRecord {
    const now = Date.now();
    const id = `dlq_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const record: DeadLetterRecord = {
      id,
      webhookId: item.webhookId,
      url: item.url,
      event: item.event,
      attempts: item.attempts,
      lastError: item.lastError,
      lastStatusCode: item.lastStatusCode,
      createdAt: now,
      lastAttemptAt: item.lastAttemptAt ?? now,
    };

    // Bounded eviction: oldest first
    if (this.store.size >= this.cap) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(id, record);
    return record;
  }

  /**
   * Retrieve a specific dead-letter record by its ID.
   */
  get(id: string): DeadLetterRecord | undefined {
    return this.store.get(id);
  }

  /**
   * List dead-letter queue records with optional filtering and pagination limits.
   * Returns items sorted newest first.
   */
  list(filter?: DeadLetterFilter): DeadLetterRecord[] {
    let items = Array.from(this.store.values());

    if (filter?.webhookId) {
      items = items.filter((r) => r.webhookId === filter.webhookId);
    }

    // Newest first
    items.sort((a, b) => b.lastAttemptAt - a.lastAttemptAt);

    const limit = Math.max(1, Math.min(filter?.limit ?? 100, 1000));
    return items.slice(0, limit);
  }

  /**
   * Update an existing dead-letter record after a failed replay attempt.
   */
  update(
    id: string,
    updates: Partial<Pick<DeadLetterRecord, "attempts" | "lastError" | "lastStatusCode" | "lastAttemptAt">>,
  ): DeadLetterRecord | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;

    const updated: DeadLetterRecord = {
      ...existing,
      ...updates,
      lastAttemptAt: updates.lastAttemptAt ?? Date.now(),
    };
    this.store.set(id, updated);
    return updated;
  }

  /**
   * Remove a resolved or purged item from the dead-letter queue.
   */
  remove(id: string): boolean {
    return this.store.delete(id);
  }

  /**
   * Clear all records from the dead-letter queue (for tests/resets).
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Current number of dead-letter records held in memory.
   */
  get size(): number {
    return this.store.size;
  }
}

/** Global dead-letter queue singleton. */
export const deadLetterQueue = new DeadLetterQueueStore();
