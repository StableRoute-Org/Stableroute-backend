import { describe, it, expect, vi } from "vitest";
import {
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookPayload,
  webhookDlq,
  deliverEventToWebhooks,
  WEBHOOK_MAX_RETRIES,
} from "./delivery";
import type { AppEvent, WebhookRecord } from "../stores";

describe("webhook delivery", () => {
  it("generates a URL-safe secret", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });

  it("signs and verifies a payload", () => {
    const secret = generateWebhookSecret();
    const payload = JSON.stringify({ event: "test" });
    const { signature, timestamp } = signWebhookPayload(secret, payload);
    expect(signature).toMatch(/^t=\d+,v0=[0-9a-f]{64}$/);
    expect(verifyWebhookPayload(secret, payload, signature)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const secret = generateWebhookSecret();
    const payload = JSON.stringify({ event: "test" });
    const { signature } = signWebhookPayload(secret, payload);
    expect(verifyWebhookPayload(secret, payload + "x", signature)).toBe(false);
  });

  it("rejects an expired signature", () => {
    const secret = generateWebhookSecret();
    const payload = JSON.stringify({ event: "test" });
    const oldTs = Math.floor(Date.now() / 1000) - 400;
    const { signature } = signWebhookPayload(secret, payload, oldTs);
    expect(verifyWebhookPayload(secret, payload, signature)).toBe(false);
  });

  it("delivers to matching webhooks", async () => {
    webhookDlq.clear();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const event: AppEvent = {
      id: "evt-1",
      ts: Date.now(),
      type: "pair.registered",
      payload: { source: "XLM", destination: "USDC" },
    };
    const webhooks = new Map<string, WebhookRecord>([
      [
        "wh-1",
        {
          url: "https://example.com/hook",
          events: ["pair.registered"],
          createdAt: Date.now(),
          secret: generateWebhookSecret(),
        },
      ],
      [
        "wh-2",
        {
          url: "https://example.com/other",
          events: ["pair.disabled"],
          createdAt: Date.now(),
          secret: generateWebhookSecret(),
        },
      ],
    ]);

    await deliverEventToWebhooks(event, webhooks, fetchMock as any);
    // Give async delivery a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Signature": expect.stringMatching(/^t=\d+,v0=[0-9a-f]{64}$/),
        }),
      }),
    );
  });

  it("dead-letters after max retries on 5xx", async () => {
    webhookDlq.clear();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const event: AppEvent = {
      id: "evt-2",
      ts: Date.now(),
      type: "pair.registered",
      payload: {},
    };
    const webhooks = new Map<string, WebhookRecord>([
      [
        "wh-1",
        {
          url: "https://example.com/hook",
          events: ["pair.registered"],
          createdAt: Date.now(),
          secret: generateWebhookSecret(),
        },
      ],
    ]);

    await deliverEventToWebhooks(event, webhooks, fetchMock as any);
    // Wait for all retries + backoff
    await new Promise((r) => setTimeout(r, 8000));

    expect(fetchMock).toHaveBeenCalledTimes(WEBHOOK_MAX_RETRIES);
    expect(webhookDlq.size).toBe(1);
    const entry = Array.from(webhookDlq.values())[0];
    expect(entry.webhookId).toBe("wh-1");
    expect(entry.attempts).toBe(WEBHOOK_MAX_RETRIES);
  });
});
