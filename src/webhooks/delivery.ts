/**
 * Webhook delivery pipeline featuring HMAC signing, bounded retries
 * with exponential backoff, and dead-letter queue routing.
 *
 * @module webhooks/delivery
 */

import type { AppEvent, WebhookRecord } from "../stores";
import { webhookStore } from "../stores";
import { deadLetterQueue } from "./deadLetterQueue";
import { signWebhookPayload } from "./signer";
import type {
  DeliveryResult,
  WebhookDeliveryOptions,
} from "./types";

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 100;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_PAYLOAD_BYTES = 65536; // 64 KB

/**
 * Helper to pause execution for a given duration.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deliver a single event to a subscriber webhook destination with HMAC signing
 * and exponential backoff retry semantics.
 *
 * If retries are exhausted or an unrecoverable failure occurs, the delivery
 * is automatically enqueued into the Dead-Letter Queue (DLQ).
 *
 * @param webhook   - The destination webhook configuration.
 * @param webhookId - ID of the webhook subscription.
 * @param event     - The system event payload to deliver.
 * @param options   - Delivery configuration options (retries, timeouts, backoff).
 * @param fetchFn   - Injectable HTTP client (defaults to standard `globalThis.fetch`).
 * @returns DeliveryResult describing the final outcome.
 */
export const deliverWebhook = async (
  webhook: WebhookRecord,
  webhookId: string,
  event: AppEvent,
  options: WebhookDeliveryOptions = {},
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DeliveryResult> => {
  const maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const backoffFactor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;

  const rawPayload = JSON.stringify(event);

  // Guard payload size
  const payloadBytes = Buffer.byteLength(rawPayload, "utf8");
  if (payloadBytes > maxPayloadBytes) {
    const errorMsg = `Payload size (${payloadBytes} bytes) exceeds maximum limit (${maxPayloadBytes} bytes)`;
    const dlqRecord = deadLetterQueue.enqueue({
      webhookId,
      url: webhook.url,
      event,
      attempts: 0,
      lastError: errorMsg,
    });

    return {
      webhookId,
      url: webhook.url,
      eventId: event.id,
      eventType: event.type,
      success: false,
      attempts: 0,
      error: errorMsg,
      deadLettered: true,
      deadLetterId: dlqRecord.id,
    };
  }

  // Sign payload
  const secret = webhook.secret || "default_webhook_secret";
  const signature = signWebhookPayload(rawPayload, secret);

  let lastError = "Unknown delivery error";
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchFn(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signature.header,
            "X-Signature-Timestamp": String(signature.timestamp),
            "X-Event-Type": event.type,
            "X-Event-Id": event.id,
          },
          body: rawPayload,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutHandle);
      }

      lastStatusCode = response.status;

      // 2xx -> Success!
      if (response.ok) {
        return {
          webhookId,
          url: webhook.url,
          eventId: event.id,
          eventType: event.type,
          success: true,
          attempts: attempt,
          statusCode: response.status,
          deadLettered: false,
        };
      }

      // 4xx -> Client error (non-retryable, e.g. 400, 401, 404)
      if (response.status >= 400 && response.status < 500) {
        lastError = `Destination rejected delivery with HTTP ${response.status}`;
        break; // Stop retrying
      }

      // 5xx -> Server error (transient, retryable)
      lastError = `Destination responded with HTTP ${response.status}`;
    } catch (err: unknown) {
      if (err instanceof Error) {
        lastError = err.name === "AbortError" ? "Request timed out" : err.message;
      } else {
        lastError = String(err);
      }
    }

    // Wait backoff if retries remain
    if (attempt < maxRetries && initialBackoffMs > 0) {
      const delay = initialBackoffMs * Math.pow(backoffFactor, attempt - 1);
      await sleep(delay);
    }
  }

  // All attempts exhausted or non-retryable error -> move to Dead-Letter Queue
  let dlqId: string | undefined;
  if (!options.skipDlqEnqueue) {
    const dlqRecord = deadLetterQueue.enqueue({
      webhookId,
      url: webhook.url,
      event,
      attempts: maxRetries,
      lastError,
      lastStatusCode,
    });
    dlqId = dlqRecord.id;
  }

  return {
    webhookId,
    url: webhook.url,
    eventId: event.id,
    eventType: event.type,
    success: false,
    attempts: maxRetries,
    statusCode: lastStatusCode,
    error: lastError,
    deadLettered: !options.skipDlqEnqueue,
    ...(dlqId ? { deadLetterId: dlqId } : {}),
  };
};

/**
 * Replay delivery for an event currently in the Dead-Letter Queue.
 *
 * If re-delivery succeeds, the record is removed from the DLQ.
 * If re-delivery fails, the record is updated with the latest failure details.
 *
 * @param id      - ID of the dead-letter queue record.
 * @param options - Optional delivery options.
 * @param fetchFn - Optional HTTP client injection.
 */
export const replayDeadLetter = async (
  id: string,
  options: WebhookDeliveryOptions = {},
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<{
  replayed: boolean;
  result?: DeliveryResult | undefined;
  error?: string | undefined;
}> => {
  const record = deadLetterQueue.get(id);
  if (!record) {
    return { replayed: false, error: "not_found" };
  }

  // Resolve webhook configuration (fallback to stored URL and empty events if deleted)
  const currentWebhook = webhookStore.get(record.webhookId) ?? {
    url: record.url,
    events: [record.event.type],
    createdAt: record.createdAt,
  };

  // Re-attempt delivery with fresh retry cycle without duplicating DLQ record
  const result = await deliverWebhook(
    currentWebhook,
    record.webhookId,
    record.event,
    { ...options, skipDlqEnqueue: true },
    fetchFn,
  );

  if (result.success) {
    deadLetterQueue.remove(id);
    return { replayed: true, result };
  }

  // Still failing: update existing DLQ record
  deadLetterQueue.update(id, {
    attempts: record.attempts + result.attempts,
    lastError: result.error ?? record.lastError,
    lastStatusCode: result.statusCode,
    lastAttemptAt: Date.now(),
  });

  return { replayed: false, result, error: result.error };
};

/**
 * Check if a webhook's subscription matches an event type.
 */
export const matchesEvent = (subscribedEvents: string[], eventType: string): boolean => {
  return subscribedEvents.includes("*") || subscribedEvents.includes(eventType);
};

/**
 * Dispatch an event to all matching registered webhooks.
 *
 * @param event   - The system event to broadcast.
 * @param options - Delivery options.
 * @param fetchFn - Optional HTTP client injection.
 */
export const dispatchWebhookEvent = async (
  event: AppEvent,
  options: WebhookDeliveryOptions = {},
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<DeliveryResult[]> => {
  const tasks: Promise<DeliveryResult>[] = [];

  for (const [webhookId, webhook] of webhookStore.entries()) {
    if (matchesEvent(webhook.events, event.type)) {
      tasks.push(deliverWebhook(webhook, webhookId, event, options, fetchFn));
    }
  }

  return Promise.all(tasks);
};
