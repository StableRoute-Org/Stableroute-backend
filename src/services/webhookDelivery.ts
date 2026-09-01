import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeliveryAttempt {
  attempt: number;
  status: "success" | "retry" | "dead_letter";
  statusCode: number;
  timestamp: number;
  error?: string;
}

export interface DeadLetterEntry {
  id: string;
  webhookId: string;
  webhookUrl: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: DeliveryAttempt[];
  createdAt: number;
  deadLetteredAt: number;
  failureReason: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env.WEBHOOK_SIGNING_SECRET || "stableroute-default-webhook-secret";

function getMaxAttempts() { return Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 5; }
function getInitialBackoffMs() { return Number(process.env.WEBHOOK_INITIAL_BACKOFF_MS) || 1000; }
function getMaxBackoffMs() { return Number(process.env.WEBHOOK_MAX_BACKOFF_MS) || 30000; }
function getRequestTimeoutMs() { return Number(process.env.WEBHOOK_TIMEOUT_MS) || 10000; }
function getMaxPayloadBytes() { return Number(process.env.WEBHOOK_MAX_PAYLOAD_BYTES) || 65536; }

// ─── Dead-letter queue (in-memory; would use Redis/DB in production) ─────────

const deadLetterQueue: DeadLetterEntry[] = [];

// ─── HMAC Signing ─────────────────────────────────────────────────────────────

/**
 * Sign a webhook payload with HMAC-SHA256.
 * Returns a header string: `t=<timestamp>,v1=<hex-signature>`.
 */
export function signPayload(
  timestamp: number,
  body: string,
  secret: string = WEBHOOK_SECRET,
): string {
  const signedPayload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify a webhook signature (for subscribers to validate).
 * Returns true if the signature is valid and within the replay window.
 */
export function verifySignature(
  signatureHeader: string,
  body: string,
  secret: string = WEBHOOK_SECRET,
  toleranceSeconds = 300,
): boolean {
  const parts = signatureHeader.split(",");
  const tsPart = parts.find((p) => p.startsWith("t="));
  const sigPart = parts.find((p) => p.startsWith("v1="));
  if (!tsPart || !sigPart) return false;

  const timestamp = Number(tsPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  // Replay protection
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;

  const expectedSig = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const providedSig = sigPart.slice(3);
  if (providedSig.length !== expectedSig.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(providedSig, "hex"),
      Buffer.from(expectedSig, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Calculate exponential backoff delay for a given attempt number.
 * Uses jitter to avoid thundering herd.
 */
export function backoffDelay(attempt: number): number {
  const base = getInitialBackoffMs() * Math.pow(2, attempt - 1);
  const capped = Math.min(base, getMaxBackoffMs());
  // Add up to 25% jitter
  const jitter = Math.random() * capped * 0.25;
  return Math.floor(capped + jitter);
}

/**
 * Deliver a webhook event to a subscriber URL with retries and dead-lettering.
 *
 * This function:
 * 1. Signs the payload with HMAC
 * 2. POSTs to the webhook URL
 * 3. On 5xx/timeout, retries with exponential backoff
 * 4. After MAX_ATTEMPTS, moves to the dead-letter queue
 */
export async function deliverWebhook(
  webhookId: string,
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryAttempt[]> {
  const body = JSON.stringify({ event: eventType, payload, timestamp: Date.now() });

  // Payload size guard
  if (Buffer.byteLength(body) > getMaxPayloadBytes()) {
    logger.warn(
      { webhookId, size: Buffer.byteLength(body) },
      "webhook payload exceeds max size, skipping delivery",
    );
    const oversizeAttempts: DeliveryAttempt[] = [
      {
        attempt: 1,
        status: "dead_letter" as const,
        statusCode: 0,
        timestamp: Date.now(),
        error: "payload exceeds maximum size",
      },
    ];
    moveToDeadLetter(
      webhookId,
      webhookUrl,
      eventType,
      payload,
      oversizeAttempts,
      "payload exceeds maximum size",
    );
    return oversizeAttempts;
  }

  const attempts: DeliveryAttempt[] = [];

  const maxAttempts = getMaxAttempts();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(timestamp, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getRequestTimeoutMs());

    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Webhook-Id": webhookId,
          "X-Webhook-Event": eventType,
          "User-Agent": "StableRoute-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        const result: DeliveryAttempt = {
          attempt,
          status: "success",
          statusCode: response.status,
          timestamp: Date.now(),
        };
        attempts.push(result);
        logger.info(
          { webhookId, eventType, attempt, status: response.status },
          "webhook delivered successfully",
        );
        return attempts;
      }

      // 4xx — do not retry (client error, payload is correct but subscriber rejected)
      if (response.status >= 400 && response.status < 500) {
        const result: DeliveryAttempt = {
          attempt,
          status: "dead_letter",
          statusCode: response.status,
          timestamp: Date.now(),
          error: `4xx client error: ${response.status}`,
        };
        attempts.push(result);
        moveToDeadLetter(
          webhookId,
          webhookUrl,
          eventType,
          payload,
          attempts,
          `4xx response: ${response.status}`,
        );
        return attempts;
      }

      // 5xx — retryable
      const result: DeliveryAttempt = {
        attempt,
        status: attempt < maxAttempts ? "retry" : "dead_letter",
        statusCode: response.status,
        timestamp: Date.now(),
        error: `5xx response: ${response.status}`,
      };
      attempts.push(result);

      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt));
      }
    } catch (err) {
      clearTimeout(timer);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: DeliveryAttempt = {
        attempt,
        status: attempt < maxAttempts ? "retry" : "dead_letter",
        statusCode: 0,
        timestamp: Date.now(),
        error: errorMsg,
      };
      attempts.push(result);

      if (attempt < maxAttempts) {
        await sleep(backoffDelay(attempt));
      }
    }
  }

  // All attempts exhausted — move to dead-letter queue
  moveToDeadLetter(
    webhookId,
    webhookUrl,
    eventType,
    payload,
    attempts,
    "all retry attempts exhausted",
  );

  return attempts;
}

// ─── Dead-letter queue management ──────────────────────────────────────────────

function moveToDeadLetter(
  webhookId: string,
  webhookUrl: string,
  eventType: string,
  payload: Record<string, unknown>,
  attempts: DeliveryAttempt[],
  reason: string,
): void {
  const entry: DeadLetterEntry = {
    id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    webhookId,
    webhookUrl,
    eventType,
    payload,
    attempts,
    createdAt: attempts[0]?.timestamp ?? Date.now(),
    deadLetteredAt: Date.now(),
    failureReason: reason,
  };
  deadLetterQueue.push(entry);
  logger.warn(
    { webhookId, eventType, reason, dlqId: entry.id },
    "webhook moved to dead-letter queue",
  );
}

export function listDeadLetter(): DeadLetterEntry[] {
  return [...deadLetterQueue];
}

export function getDeadLetterEntry(id: string): DeadLetterEntry | undefined {
  return deadLetterQueue.find((e) => e.id === id);
}

/**
 * Replay a dead-lettered webhook by re-attempting delivery.
 * Returns the new delivery attempts. Removes from DLQ on success.
 */
export async function replayDeadLetter(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryAttempt[] | null> {
  const entry = deadLetterQueue.find((e) => e.id === id);
  if (!entry) return null;

  const attempts = await deliverWebhook(
    entry.webhookId,
    entry.webhookUrl,
    entry.eventType,
    entry.payload,
    fetchImpl,
  );

  // If the last attempt was successful, remove from DLQ
  if (attempts[attempts.length - 1]?.status === "success") {
    const idx = deadLetterQueue.findIndex((e) => e.id === id);
    if (idx !== -1) deadLetterQueue.splice(idx, 1);
  }

  return attempts;
}

export function clearDeadLetter(): void {
  deadLetterQueue.length = 0;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { deadLetterQueue, WEBHOOK_SECRET };
