/**
 * Type definitions for the concurrency-safe Idempotency Subsystem.
 *
 * Provides typed contracts for idempotency records, atomic lock acquisitions,
 * and the storage interface supporting exactly-once replay semantics.
 *
 * @module idempotency/types
 */

export type IdempotencyStatus = "in_progress" | "completed";

export interface IdempotencyRecord {
  /** The idempotency key provided by the client. */
  key: string;
  /** Tenant or API key identifier that scopes this key. */
  tenantId: string;
  /** Cryptographic fingerprint of method, path, tenant, and canonical body. */
  fingerprint: string;
  /** Lifecycle state: "in_progress" while being processed, "completed" after response. */
  status: IdempotencyStatus;
  /** HTTP status code captured from the completed response. */
  statusCode?: number;
  /** Parsed JSON response payload captured from the completed response. */
  responseBody?: unknown;
  /** Epoch-ms timestamp when the record was created. */
  createdAt: number;
  /** Epoch-ms timestamp when the record expires. */
  expiresAt: number;
}

/**
 * Result of an atomic lock acquisition attempt on an idempotency key.
 */
export type LockResult =
  | { status: "acquired" }
  | { status: "in_progress" }
  | { status: "conflict" }
  | { status: "completed"; statusCode: number; responseBody: unknown };

/**
 * Abstract storage interface for idempotency key management.
 *
 * Implementations must guarantee atomic lock acquisition to prevent
 * race conditions between concurrent requests sharing the same key.
 */
export interface IdempotencyStore {
  /**
   * Attempt to atomically acquire an idempotency lock for a key.
   *
   * - If the key is new or expired: marks "in_progress" and returns `{ status: "acquired" }`.
   * - If the key is currently "in_progress": returns `{ status: "in_progress" }`.
   * - If the key is completed with matching fingerprint: returns `{ status: "completed", statusCode, responseBody }`.
   * - If the key has a different fingerprint: returns `{ status: "conflict" }`.
   */
  acquire(
    key: string,
    tenantId: string,
    fingerprint: string,
    ttlMs?: number | undefined,
  ): Promise<LockResult>;

  /**
   * Complete an in-progress idempotency record with the final response status and body.
   */
  complete(
    key: string,
    tenantId: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void>;

  /**
   * Release an in-progress lock in the event of an unhandled failure,
   * allowing the client to retry cleanly without waiting for TTL expiry.
   */
  release(key: string, tenantId: string): Promise<void>;

  /**
   * Retrieve a record by key and tenant.
   */
  get(key: string, tenantId: string): Promise<IdempotencyRecord | undefined>;

  /**
   * Delete a single record.
   */
  delete(key: string, tenantId: string): Promise<void>;

  /**
   * Clear all stored records (used for test isolation).
   */
  clear(): Promise<void>;
}
