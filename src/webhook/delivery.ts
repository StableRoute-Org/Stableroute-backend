/**
 * @module webhook/delivery
 * @description Signed webhook delivery with bounded retries and dead-letter queue.
 *
 * Each event is delivered to every matching webhook subscriber:
 * 1. Payload is signed with HMAC-SHA256 (X-Signature header + timestamp)
 * 2. Delivery is attempted with exponential backoff on 5xx/timeout
 * 3. After MAX_RETRIES attempts, the event moves to the dead-letter queue
 */

import { createHmac, randomBytes } from "node:crypto";
import type { AppEvent, WebhookRecord } from "../stores";

/** Maximum delivery attempts before an event is dead-lettered. */
export const WEBHOOK_MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (1s, 2s, 4s). */
export const WEBHOOK_RETRY_BASE_MS = 1000;

/** How long a delivered payload signature remains valid (seconds). */
export const WEBHOOK_SIG_TTL_SECS = 300;

/** Generate a URL-safe random secret for a new webhook subscription. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Sign a webhook payload with HMAC-SHA256. Returns `t=<unix>,v0=<hex>`. */
export function signWebhookPayload(
  secret: string,
  payload: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { signature: string; timestamp: number } {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return { signature: `t=${timestamp},v0=${sig}`, timestamp };
}

/** Verify a webhook signature. */
export function verifyWebhookPayload(
  secret: string,
  payload: string,
  signature: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const m = signature.match(/^t=(\d+),v0=([0-9a-f]{64})$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(nowSec - ts) > WEBHOOK_SIG_TTL_SECS) return false;
  const expected = signWebhookPayload(secret, payload, ts).signature;
  return signature === expected;
}

/** Dead-letter entry for a failed webhook delivery. */
export interface WebhookDeadLetter {
  id: string;
  webhookId: string;
  url: string;
  event: AppEvent;
  attempts: number;
  lastError: string;
  deadAt: number;
}

/** In-memory DLQ keyed by entry id. */
export const webhookDlq = new Map<string, WebhookDeadLetter>();

/** In-flight delivery attempts so we can cap concurrency. */
const inFlight = new Set<string>();

/** Deliver a single event to every matching webhook. */
export async function deliverEventToWebhooks(
  event: AppEvent,
  webhooks: Map<string, WebhookRecord>,
  httpClient: typeof fetch = fetch,
): Promise<void> {
  for (const [id, record] of webhooks) {
    if (!record.events.includes(event.type)) continue;
    if (!record.secret) continue; // safety: cannot sign without secret
    attemptDelivery(id, record, event, 0, httpClient).catch(() => {});
  }
}

async function attemptDelivery(
  webhookId: string,
  record: WebhookRecord,
  event: AppEvent,
  attempt: number,
  httpClient: typeof fetch,
): Promise<void> {
  const payload = JSON.stringify({
    eventId: event.id,
    type: event.type,
    timestamp: event.ts,
    payload: event.payload,
  });

  const { signature } = signWebhookPayload(record.secret!, payload);

  try {
    const res = await httpClient(record.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature,
        "User-Agent": "StableRoute-Webhook/1.0",
      },
      body: payload,
    });

    if (res.ok) return; // 2xx = success

    const status = res.status;
    if (status >= 500 || status === 408 || status === 429) {
      // Retryable
      await scheduleRetry(webhookId, record, event, attempt, `HTTP ${status}`, httpClient);
      return;
    }
    // 4xx (except 408/429) = non-retryable, dead-letter immediately
    deadLetter(webhookId, record, event, attempt + 1, `HTTP ${status}`);
  } catch (err) {
    // Network/timeout error = retryable
    const msg = err instanceof Error ? err.message : String(err);
    await scheduleRetry(webhookId, record, event, attempt, msg, httpClient);
  }
}

async function scheduleRetry(
  webhookId: string,
  record: WebhookRecord,
  event: AppEvent,
  attempt: number,
  errorMsg: string,
  httpClient: typeof fetch,
): Promise<void> {
  if (attempt >= WEBHOOK_MAX_RETRIES - 1) {
    deadLetter(webhookId, record, event, attempt + 1, errorMsg);
    return;
  }
  const delay = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt);
  await new Promise((r) => setTimeout(r, delay));
  return attemptDelivery(webhookId, record, event, attempt + 1, httpClient);
}

function deadLetter(
  webhookId: string,
  record: WebhookRecord,
  event: AppEvent,
  attempts: number,
  lastError: string,
): void {
  const id = `${webhookId}::${event.id}::${Date.now()}`;
  webhookDlq.set(id, {
    id,
    webhookId,
    url: record.url,
    event,
    attempts,
    lastError,
    deadAt: Date.now(),
  });
}
