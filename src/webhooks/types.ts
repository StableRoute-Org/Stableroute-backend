/**
 * Domain types for signed webhook delivery, retry management,
 * and dead-letter queue (DLQ) tracking (Issue #552).
 *
 * @module webhooks/types
 */

import type { AppEvent } from "../stores";

/**
 * Result of signing a webhook payload with HMAC-SHA256.
 */
export interface WebhookSignature {
  /** The hex-encoded HMAC-SHA256 signature string. */
  signature: string;
  /** Epoch-ms timestamp captured at signing time. */
  timestamp: number;
  /** Formatted header string: `t=<timestamp>,v1=<signature>`. */
  header: string;
}

/**
 * Configuration options governing webhook delivery attempts,
 * timeouts, and retry backoff.
 */
export interface WebhookDeliveryOptions {
  /** Maximum number of delivery attempts before dead-lettering. Default 3. */
  maxRetries?: number;
  /** Initial backoff delay in milliseconds. Default 100ms. */
  initialBackoffMs?: number;
  /** Multiplier applied to backoff delay on each subsequent retry. Default 2. */
  backoffFactor?: number;
  /** HTTP request timeout in milliseconds. Default 5000ms. */
  timeoutMs?: number;
  /** Maximum allowed payload size in bytes. Default 65536 (64 KB). */
  maxPayloadBytes?: number;
  /** If true, do not enqueue into DLQ on failure (used during replay). */
  skipDlqEnqueue?: boolean | undefined;
}

/**
 * Audit record of an individual delivery attempt.
 */
export interface DeliveryAttempt {
  attempt: number;
  timestamp: number;
  success: boolean;
  statusCode?: number | undefined;
  error?: string | undefined;
}

/**
 * Overall outcome of delivering an event to a subscriber webhook.
 */
export interface DeliveryResult {
  webhookId: string;
  url: string;
  eventId: string;
  eventType: string;
  success: boolean;
  attempts: number;
  statusCode?: number | undefined;
  error?: string | undefined;
  deadLettered: boolean;
  deadLetterId?: string | undefined;
}

/**
 * A failed webhook event moved to the Dead-Letter Queue (DLQ)
 * after exhausting delivery retries or encountering an unrecoverable failure.
 */
export interface DeadLetterRecord {
  /** Unique dead-letter identifier (`dlq_<uuid>`). */
  id: string;
  /** ID of the subscribing webhook. */
  webhookId: string;
  /** Destination callback URL. */
  url: string;
  /** The original system event that failed to deliver. */
  event: AppEvent;
  /** Total number of delivery attempts made before dead-lettering. */
  attempts: number;
  /** Description of the final failure encountered. */
  lastError: string;
  /** HTTP status code of the final attempt, if a response was received. */
  lastStatusCode?: number | undefined;
  /** Epoch-ms when the record was placed in the dead-letter queue. */
  createdAt: number;
  /** Epoch-ms of the most recent delivery or replay attempt. */
  lastAttemptAt: number;
}

/**
 * Query filter for listing dead-letter queue entries.
 */
export interface DeadLetterFilter {
  /** Filter entries by originating webhook ID. */
  webhookId?: string | undefined;
  /** Maximum number of records to return. Default 100. */
  limit?: number | undefined;
}
