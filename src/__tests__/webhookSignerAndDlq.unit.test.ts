/**
 * Unit test suite for Webhook HMAC signing, verification, and Dead-Letter Queue (DLQ).
 *
 * Covers:
 * - [x] Valid signature generation and header formatting
 * - [x] Successful verification of authentic payloads
 * - [x] Tampered payload detection (fails verification)
 * - [x] Expired / stale timestamp replay protection
 * - [x] Wrong secret rejection
 * - [x] Malformed header parsing
 * - [x] DLQ store bounding, eviction, listing, retrieval, and removal
 *
 * @module __tests__/webhookSignerAndDlq.unit.test
 */

import {
  signWebhookPayload,
  verifyWebhookSignature,
  parseSignatureHeader,
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
} from "../webhooks/signer";
import { DeadLetterQueueStore } from "../webhooks/deadLetterQueue";
import type { AppEvent } from "../stores";

describe("Webhook Signer & Verifier", () => {
  const secret = "whsec_test_secret_key_1234567890";
  const payload = JSON.stringify({
    id: "evt_123",
    type: "pair.registered",
    payload: { source: "USDC", destination: "EURC" },
  });

  describe("signWebhookPayload", () => {
    it("generates a valid hex HMAC signature with timestamp and header", () => {
      const ts = 1726612800000;
      const sig = signWebhookPayload(payload, secret, ts);

      expect(sig.timestamp).toBe(ts);
      expect(sig.signature).toMatch(/^[0-9a-f]{64}$/);
      expect(sig.header).toBe(`t=${ts},v1=${sig.signature}`);
    });

    it("defaults timestamp to approximately Date.now() when omitted", () => {
      const before = Date.now();
      const sig = signWebhookPayload(payload, secret);
      const after = Date.now();

      expect(sig.timestamp).toBeGreaterThanOrEqual(before);
      expect(sig.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("parseSignatureHeader", () => {
    it("parses valid header with timestamp and signature", () => {
      const header = "t=1726612800000,v1=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
      const parsed = parseSignatureHeader(header);

      expect(parsed).not.toBeNull();
      expect(parsed?.timestamp).toBe(1726612800000);
      expect(parsed?.signature).toBe("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    });

    it("returns null for malformed or missing fields", () => {
      expect(parseSignatureHeader("")).toBeNull();
      expect(parseSignatureHeader("invalid_header")).toBeNull();
      expect(parseSignatureHeader("t=not_a_number,v1=123")).toBeNull();
      expect(parseSignatureHeader("t=12345")).toBeNull(); // missing v1
      expect(parseSignatureHeader("v1=abcdef")).toBeNull(); // missing t
      expect(parseSignatureHeader("t=12345,v1=not_hex_length")).toBeNull();
    });
  });

  describe("verifyWebhookSignature", () => {
    it("verifies authentic payload within tolerance window", () => {
      const now = Date.now();
      const sig = signWebhookPayload(payload, secret, now);
      const valid = verifyWebhookSignature(payload, sig.header, secret);

      expect(valid).toBe(true);
    });

    it("verifies authentic Buffer payload", () => {
      const now = Date.now();
      const sig = signWebhookPayload(payload, secret, now);
      const buf = Buffer.from(payload, "utf8");
      const valid = verifyWebhookSignature(buf, sig.header, secret);

      expect(valid).toBe(true);
    });

    it("rejects tampered payload (Edge Case 5)", () => {
      const now = Date.now();
      const sig = signWebhookPayload(payload, secret, now);

      const tamperedPayload = JSON.stringify({
        id: "evt_123",
        type: "pair.registered",
        payload: { source: "USDC", destination: "HACKED" },
      });

      const valid = verifyWebhookSignature(tamperedPayload, sig.header, secret);
      expect(valid).toBe(false);
    });

    it("rejects wrong secret", () => {
      const now = Date.now();
      const sig = signWebhookPayload(payload, secret, now);
      const wrongSecret = "whsec_wrong_secret_key_99999999";

      const valid = verifyWebhookSignature(payload, sig.header, wrongSecret);
      expect(valid).toBe(false);
    });

    it("rejects expired timestamp older than tolerance", () => {
      const oldTime = Date.now() - (DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 10) * 1000;
      const sig = signWebhookPayload(payload, secret, oldTime);

      const valid = verifyWebhookSignature(payload, sig.header, secret);
      expect(valid).toBe(false);
    });

    it("rejects future timestamp exceeding tolerance window", () => {
      const futureTime = Date.now() + (DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 10) * 1000;
      const sig = signWebhookPayload(payload, secret, futureTime);

      const valid = verifyWebhookSignature(payload, sig.header, secret);
      expect(valid).toBe(false);
    });

    it("accepts arbitrary timestamp when toleranceSeconds is 0 (disabled drift check)", () => {
      const ancientTime = 1000000;
      const sig = signWebhookPayload(payload, secret, ancientTime);

      const valid = verifyWebhookSignature(payload, sig.header, secret, 0);
      expect(valid).toBe(true);
    });

    it("returns false for invalid secret or empty signature header", () => {
      expect(verifyWebhookSignature(payload, "", secret)).toBe(false);
      expect(verifyWebhookSignature(payload, "t=123,v1=abc", "")).toBe(false);
    });
  });
});

describe("DeadLetterQueueStore", () => {
  const dummyEvent: AppEvent = {
    id: "evt_test_1",
    ts: Date.now(),
    type: "pair.registered",
    payload: { source: "USDC", destination: "EURC" },
  };

  it("enqueues and retrieves dead-letter records", () => {
    const dlq = new DeadLetterQueueStore(10);
    const item = dlq.enqueue({
      webhookId: "wh_1",
      url: "https://example.com/webhook",
      event: dummyEvent,
      attempts: 3,
      lastError: "Connection refused",
      lastStatusCode: 503,
    });

    expect(item.id).toMatch(/^dlq_/);
    expect(item.webhookId).toBe("wh_1");
    expect(item.attempts).toBe(3);
    expect(item.lastError).toBe("Connection refused");
    expect(item.lastStatusCode).toBe(503);
    expect(dlq.size).toBe(1);

    const retrieved = dlq.get(item.id);
    expect(retrieved).toEqual(item);
  });

  it("lists records ordered by lastAttemptAt descending", async () => {
    const dlq = new DeadLetterQueueStore(10);
    const item1 = dlq.enqueue({
      webhookId: "wh_1",
      url: "https://example.com/1",
      event: dummyEvent,
      attempts: 3,
      lastError: "Err 1",
      lastAttemptAt: 1000,
    });

    const item2 = dlq.enqueue({
      webhookId: "wh_2",
      url: "https://example.com/2",
      event: dummyEvent,
      attempts: 3,
      lastError: "Err 2",
      lastAttemptAt: 2000,
    });

    const list = dlq.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe(item2.id); // newest first
    expect(list[1]!.id).toBe(item1.id);
  });

  it("filters dead-letter records by webhookId", () => {
    const dlq = new DeadLetterQueueStore(10);
    dlq.enqueue({
      webhookId: "wh_A",
      url: "https://example.com/A",
      event: dummyEvent,
      attempts: 3,
      lastError: "Err A",
    });

    dlq.enqueue({
      webhookId: "wh_B",
      url: "https://example.com/B",
      event: dummyEvent,
      attempts: 3,
      lastError: "Err B",
    });

    const filtered = dlq.list({ webhookId: "wh_A" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.webhookId).toBe("wh_A");
  });

  it("bounds size and evicts oldest items when cap is exceeded", () => {
    const dlq = new DeadLetterQueueStore(3);
    const first = dlq.enqueue({
      webhookId: "wh_1",
      url: "https://example.com/1",
      event: dummyEvent,
      attempts: 1,
      lastError: "Err 1",
    });

    dlq.enqueue({
      webhookId: "wh_2",
      url: "https://example.com/2",
      event: dummyEvent,
      attempts: 1,
      lastError: "Err 2",
    });

    dlq.enqueue({
      webhookId: "wh_3",
      url: "https://example.com/3",
      event: dummyEvent,
      attempts: 1,
      lastError: "Err 3",
    });

    expect(dlq.size).toBe(3);

    // 4th insert should evict `first`
    dlq.enqueue({
      webhookId: "wh_4",
      url: "https://example.com/4",
      event: dummyEvent,
      attempts: 1,
      lastError: "Err 4",
    });

    expect(dlq.size).toBe(3);
    expect(dlq.get(first.id)).toBeUndefined();
  });

  it("removes records and updates records on replay", () => {
    const dlq = new DeadLetterQueueStore(10);
    const item = dlq.enqueue({
      webhookId: "wh_1",
      url: "https://example.com/1",
      event: dummyEvent,
      attempts: 3,
      lastError: "500 Internal Error",
    });

    dlq.update(item.id, {
      attempts: 6,
      lastError: "Still 500 Internal Error",
      lastStatusCode: 500,
    });

    const updated = dlq.get(item.id);
    expect(updated?.attempts).toBe(6);
    expect(updated?.lastError).toBe("Still 500 Internal Error");

    const removed = dlq.remove(item.id);
    expect(removed).toBe(true);
    expect(dlq.get(item.id)).toBeUndefined();
    expect(dlq.remove("nonexistent")).toBe(false);
  });
});
