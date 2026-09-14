import { describe, it, expect, beforeEach } from "vitest";
import { signWebhookPayload, verifyWebhookSignature, DeadLetterQueue } from "../utils/webhookDelivery";

describe("webhook signing", () => {
  it("signs payload deterministically", () => {
    const payload = { event: "test", data: { id: 1 } };
    const sig1 = signWebhookPayload(payload, "secret", 1234567890);
    const sig2 = signWebhookPayload(payload, "secret", 1234567890);
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signWebhookPayload({ a: 1 }, "secret", 1234567890);
    const sig2 = signWebhookPayload({ a: 2 }, "secret", 1234567890);
    expect(sig1).not.toBe(sig2);
  });

  it("verifies valid signature", () => {
    const payload = { event: "test" };
    const sig = signWebhookPayload(payload, "secret", 1234567890);
    expect(verifyWebhookSignature(payload, sig, "secret", 1234567890)).toBe(true);
  });

  it("rejects invalid signature", () => {
    const payload = { event: "test" };
    expect(verifyWebhookSignature(payload, "invalid", "secret", 1234567890)).toBe(false);
  });
});

describe("DeadLetterQueue", () => {
  let queue: DeadLetterQueue;

  beforeEach(() => {
    queue = new DeadLetterQueue(10);
  });

  it("adds entries", () => {
    queue.add({ id: "", url: "http://example.com", payload: {}, error: "fail", failedAt: Date.now(), attempts: 3 });
    expect(queue.size()).toBe(1);
  });

  it("evicts oldest when full", () => {
    const smallQueue = new DeadLetterQueue(2);
    smallQueue.add({ id: "", url: "http://a.com", payload: {}, error: "e", failedAt: Date.now(), attempts: 1 });
    smallQueue.add({ id: "", url: "http://b.com", payload: {}, error: "e", failedAt: Date.now(), attempts: 1 });
    smallQueue.add({ id: "", url: "http://c.com", payload: {}, error: "e", failedAt: Date.now(), attempts: 1 });
    expect(smallQueue.size()).toBe(2);
  });

  it("retries an entry", () => {
    queue.add({ id: "", url: "http://example.com", payload: {}, error: "fail", failedAt: Date.now(), attempts: 3 });
    const entry = queue.getAll()[0];
    const retried = queue.retry(entry.id);
    expect(retried).toBeTruthy();
    expect(queue.size()).toBe(0);
  });

  it("clears all entries", () => {
    queue.add({ id: "", url: "http://a.com", payload: {}, error: "e", failedAt: Date.now(), attempts: 1 });
    queue.add({ id: "", url: "http://b.com", payload: {}, error: "e", failedAt: Date.now(), attempts: 1 });
    queue.clear();
    expect(queue.size()).toBe(0);
  });
});
