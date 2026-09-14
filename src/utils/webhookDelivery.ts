import { createHmac, createHash, randomBytes } from "node:crypto";
import { logger } from "../logger";

export interface WebhookDeliveryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  secret?: string;
}

export interface DeliveryResult {
  success: boolean;
  attempts: number;
  lastError?: string;
  deadLettered?: boolean;
}

export function signWebhookPayload(payload: unknown, secret: string, timestamp: number): string {
  const data = `${timestamp}.${JSON.stringify(payload)}`;
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function verifyWebhookSignature(payload: unknown, signature: string, secret: string, timestamp: number): boolean {
  const expected = signWebhookPayload(payload, secret, timestamp);
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(sigBuffer, expectedBuffer);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export async function deliverWebhook(
  url: string,
  payload: unknown,
  config: WebhookDeliveryConfig = {}
): Promise<DeliveryResult> {
  const maxRetries = config.maxRetries ?? 3;
  const baseDelay = config.baseDelayMs ?? 1000;
  const timeout = config.timeoutMs ?? 10000;
  const secret = config.secret ?? process.env.WEBHOOK_SECRET ?? "default-secret";

  const timestamp = Date.now();
  const signature = signWebhookPayload(payload, secret, timestamp);

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Timestamp": String(timestamp),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        return { success: true, attempts: attempt + 1 };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  logger.warn({ url, error: lastError }, "webhook delivery failed after retries");
  return { success: false, attempts: maxRetries + 1, lastError, deadLettered: true };
}

export interface DeadLetterEntry {
  id: string;
  url: string;
  payload: unknown;
  error: string;
  failedAt: number;
  attempts: number;
}

export class DeadLetterQueue {
  private entries: DeadLetterQueueItem[] = [];

  constructor(private maxSize: number = 1000) {}

  add(entry: DeadLetterEntry): void {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();
    }
    this.entries.push({ ...entry, id: randomBytes(16).toString("hex") });
  }

  getAll(): DeadLetterEntry[] {
    return [...this.entries];
  }

  get(id: string): DeadLetterEntry | undefined {
    return this.entries.find(e => e.id === id);
  }

  retry(id: string): DeadLetterEntry | undefined {
    const entry = this.entries.find(e => e.id === id);
    if (entry) {
      this.entries = this.entries.filter(e => e.id !== id);
    }
    return entry;
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}

interface DeadLetterQueueItem extends DeadLetterEntry {
  id: string;
}

export const deadLetterQueue = new DeadLetterQueue();
