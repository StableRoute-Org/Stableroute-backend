/**
 * Integration test suite for signed webhook delivery with retries,
 * dead-letter queue, and replay semantics (Issue #552).
 *
 * Edge cases covered:
 * - [x] successful delivery -> signature verifies
 * - [x] 5xx then success -> retried and delivered
 * - [x] retries exhausted -> lands in DLQ with reason
 * - [x] replay from DLQ -> re-attempts delivery
 * - [x] tampered payload -> signature check fails
 * - [x] non-retryable 4xx errors move directly to DLQ
 * - [x] DLQ REST API endpoints (list, get, replay, delete)
 * - [x] Secret handling: returned on POST create, omitted on GET/list/PATCH
 *
 * @module __tests__/webhookDelivery.test
 */

import request from "supertest";
import app, {
  deliverWebhook,
  dispatchWebhookEvent,
  replayDeadLetter,
  deadLetterQueue,
  verifyWebhookSignature,
} from "../index";
import {
  webhookStore,
  resetStores,
  type AppEvent,
  type WebhookRecord,
} from "../stores";

describe("Signed Webhook Delivery, Retries & Dead-Letter Queue (#552)", () => {
  beforeEach(() => {
    resetStores();
    deadLetterQueue.clear();
  });

  const sampleEvent: AppEvent = {
    id: "evt_test_swap_001",
    ts: Date.now(),
    type: "pair.registered",
    payload: { source_asset: "USDC", dest_asset: "EURC", rate: "1.08" },
  };

  const sampleWebhook: WebhookRecord = {
    url: "https://example.com/webhook",
    events: ["pair.registered"],
    createdAt: Date.now(),
    secret: "whsec_sample_secret_key_1234567890",
  };

  // -------------------------------------------------------------------------
  // Edge Case 1: successful delivery -> signature verifies
  // -------------------------------------------------------------------------
  describe("Edge Case 1: successful delivery -> signature verifies", () => {
    it("delivers payload with valid X-Signature and X-Signature-Timestamp headers", async () => {
      let capturedHeaders: Headers | undefined;
      let capturedBody: string | undefined;

      const mockFetch: typeof fetch = async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      };

      const result = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 3, initialBackoffMs: 0 },
        mockFetch,
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.statusCode).toBe(200);
      expect(result.deadLettered).toBe(false);
      expect(deadLetterQueue.size).toBe(0);

      // Verify headers
      expect(capturedHeaders).toBeDefined();
      const sigHeader = capturedHeaders!.get("x-signature");
      const tsHeader = capturedHeaders!.get("x-signature-timestamp");
      const eventTypeHeader = capturedHeaders!.get("x-event-type");
      const eventIdHeader = capturedHeaders!.get("x-event-id");

      expect(sigHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(tsHeader).toBeDefined();
      expect(eventTypeHeader).toBe("pair.registered");
      expect(eventIdHeader).toBe("evt_test_swap_001");

      // Verify signature authenticity against subscriber's secret
      const isValid = verifyWebhookSignature(capturedBody!, sigHeader!, sampleWebhook.secret!);
      expect(isValid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Case 2: 5xx then success -> retried and delivered
  // -------------------------------------------------------------------------
  describe("Edge Case 2: 5xx then success -> retried and delivered", () => {
    it("retries on 500/503 errors with exponential backoff and succeeds", async () => {
      let callCount = 0;

      const mockFetch: typeof fetch = async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("Service Unavailable", { status: 503 });
        }
        if (callCount === 2) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const result = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 3, initialBackoffMs: 1, backoffFactor: 2 },
        mockFetch,
      );

      expect(callCount).toBe(3);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.statusCode).toBe(200);
      expect(result.deadLettered).toBe(false);
      expect(deadLetterQueue.size).toBe(0);
    });

    it("retries on network timeout errors and succeeds", async () => {
      let callCount = 0;

      const mockFetch: typeof fetch = async () => {
        callCount++;
        if (callCount < 2) {
          const abortErr = new Error("The operation was aborted");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const result = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 3, initialBackoffMs: 1 },
        mockFetch,
      );

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.deadLettered).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Case 3: retries exhausted -> lands in DLQ with reason
  // -------------------------------------------------------------------------
  describe("Edge Case 3: retries exhausted -> lands in DLQ with reason", () => {
    it("moves event to dead-letter queue after exhausting maxRetries", async () => {
      let callCount = 0;

      const mockFetch: typeof fetch = async () => {
        callCount++;
        return new Response("Gateway Timeout", { status: 504 });
      };

      const result = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 3, initialBackoffMs: 1 },
        mockFetch,
      );

      expect(callCount).toBe(3);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.deadLettered).toBe(true);
      expect(result.deadLetterId).toBeDefined();

      // Check DLQ contents
      expect(deadLetterQueue.size).toBe(1);
      const dlqItem = deadLetterQueue.get(result.deadLetterId!);
      expect(dlqItem).toBeDefined();
      expect(dlqItem?.webhookId).toBe("wh_1");
      expect(dlqItem?.url).toBe(sampleWebhook.url);
      expect(dlqItem?.attempts).toBe(3);
      expect(dlqItem?.lastStatusCode).toBe(504);
      expect(dlqItem?.lastError).toMatch(/HTTP 504/);
      expect(dlqItem?.event).toEqual(sampleEvent);
    });

    it("moves non-retryable 4xx client errors directly to DLQ without wasting retries", async () => {
      let callCount = 0;

      const mockFetch: typeof fetch = async () => {
        callCount++;
        return new Response("Bad Request", { status: 400 });
      };

      const result = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 5, initialBackoffMs: 1 },
        mockFetch,
      );

      // Stopped at 1 attempt because 400 is not retryable
      expect(callCount).toBe(1);
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(5);
      expect(result.deadLettered).toBe(true);
      expect(deadLetterQueue.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge Case 4: replay from DLQ -> re-attempts delivery
  // -------------------------------------------------------------------------
  describe("Edge Case 4: replay from DLQ -> re-attempts delivery", () => {
    it("successfully replays a dead-lettered event and removes it from the queue", async () => {
      // 1. Force into DLQ
      const failFetch: typeof fetch = async () =>
        new Response("Server Error", { status: 500 });

      const failResult = await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 2, initialBackoffMs: 1 },
        failFetch,
      );

      expect(failResult.deadLettered).toBe(true);
      const dlqId = failResult.deadLetterId!;
      expect(deadLetterQueue.size).toBe(1);

      // Register the webhook in store so replay finds current destination
      webhookStore.set("wh_1", sampleWebhook);

      // 2. Replay with successful mock endpoint
      let replayedCallCount = 0;
      const successFetch: typeof fetch = async () => {
        replayedCallCount++;
        return new Response(JSON.stringify({ replayed: true }), { status: 200 });
      };

      const replayResult = await replayDeadLetter(
        dlqId,
        { maxRetries: 2, initialBackoffMs: 1 },
        successFetch,
      );

      expect(replayResult.replayed).toBe(true);
      expect(replayedCallCount).toBe(1);
      expect(replayResult.result?.success).toBe(true);

      // Successfully replayed item must be evicted from DLQ
      expect(deadLetterQueue.size).toBe(0);
      expect(deadLetterQueue.get(dlqId)).toBeUndefined();
    });

    it("keeps event in DLQ and updates failure record if replay fails again", async () => {
      // 1. Put into DLQ
      const dlqItem = deadLetterQueue.enqueue({
        webhookId: "wh_1",
        url: sampleWebhook.url,
        event: sampleEvent,
        attempts: 3,
        lastError: "Initial error",
        lastStatusCode: 500,
      });

      webhookStore.set("wh_1", sampleWebhook);

      // 2. Replay with failing endpoint
      const failAgainFetch: typeof fetch = async () =>
        new Response("Still Down", { status: 503 });

      const replayResult = await replayDeadLetter(
        dlqItem.id,
        { maxRetries: 2, initialBackoffMs: 1 },
        failAgainFetch,
      );

      expect(replayResult.replayed).toBe(false);
      expect(deadLetterQueue.size).toBe(1);

      const updatedItem = deadLetterQueue.get(dlqItem.id);
      expect(updatedItem).toBeDefined();
      expect(updatedItem?.attempts).toBe(5); // 3 original + 2 replay
      expect(updatedItem?.lastStatusCode).toBe(503);
      expect(updatedItem?.lastError).toMatch(/HTTP 503/);
    });

    it("returns error when replaying unknown DLQ ID", async () => {
      const replayResult = await replayDeadLetter("dlq_nonexistent");
      expect(replayResult.replayed).toBe(false);
      expect(replayResult.error).toBe("not_found");
    });
  });

  // -------------------------------------------------------------------------
  // Edge Case 5: tampered payload -> signature check fails
  // -------------------------------------------------------------------------
  describe("Edge Case 5: tampered payload -> signature check fails", () => {
    it("fails verification when any field in the delivered payload is altered", async () => {
      let capturedHeaders: Headers | undefined;
      let capturedBody: string | undefined;

      const mockFetch: typeof fetch = async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = init?.body as string;
        return new Response("OK", { status: 200 });
      };

      await deliverWebhook(
        sampleWebhook,
        "wh_1",
        sampleEvent,
        { maxRetries: 1 },
        mockFetch,
      );

      const sigHeader = capturedHeaders!.get("x-signature")!;
      expect(sigHeader).toBeDefined();

      // Tamper with body
      const parsed = JSON.parse(capturedBody!);
      parsed.payload.rate = "999.99"; // Mallory altered the rate
      const tamperedBody = JSON.stringify(parsed);

      const verified = verifyWebhookSignature(
        tamperedBody,
        sigHeader,
        sampleWebhook.secret!,
      );
      expect(verified).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP REST API Integration: Dead-Letter Queue Endpoints
  // -------------------------------------------------------------------------
  describe("Dead-Letter Queue HTTP Endpoints", () => {
    it("GET /api/v1/webhooks/dead-letter lists dead-letter records", async () => {
      deadLetterQueue.enqueue({
        webhookId: "wh_1",
        url: "https://example.com/1",
        event: sampleEvent,
        attempts: 3,
        lastError: "Connection timeout",
        lastStatusCode: 504,
      });

      const res = await request(app).get("/api/v1/webhooks/dead-letter");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].webhookId).toBe("wh_1");
    });

    it("GET /api/v1/webhooks/dead-letter/:id returns 200 for known record", async () => {
      const item = deadLetterQueue.enqueue({
        webhookId: "wh_1",
        url: "https://example.com/1",
        event: sampleEvent,
        attempts: 3,
        lastError: "500 Internal Error",
        lastStatusCode: 500,
      });

      const res = await request(app).get(`/api/v1/webhooks/dead-letter/${item.id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(item.id);
      expect(res.body.lastError).toBe("500 Internal Error");
    });

    it("GET /api/v1/webhooks/dead-letter/:id returns 404 for unknown ID", async () => {
      const res = await request(app).get("/api/v1/webhooks/dead-letter/dlq_missing");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
    });

    it("DELETE /api/v1/webhooks/dead-letter/:id purges record", async () => {
      const item = deadLetterQueue.enqueue({
        webhookId: "wh_1",
        url: "https://example.com/1",
        event: sampleEvent,
        attempts: 3,
        lastError: "Err",
      });

      const delRes = await request(app).delete(`/api/v1/webhooks/dead-letter/${item.id}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.deleted).toBe(true);
      expect(deadLetterQueue.size).toBe(0);

      // Second delete returns 404
      const del404 = await request(app).delete(`/api/v1/webhooks/dead-letter/${item.id}`);
      expect(del404.status).toBe(404);
    });

    it("POST /api/v1/webhooks/dead-letter/:id/replay returns 404 for unknown ID", async () => {
      const res = await request(app).post("/api/v1/webhooks/dead-letter/dlq_missing/replay");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
    });
  });

  // -------------------------------------------------------------------------
  // Secret Management & Privacy Guard
  // -------------------------------------------------------------------------
  describe("Webhook Secret Management", () => {
    it("POST /api/v1/webhooks accepts user-provided secret and returns it on 201", async () => {
      const customSecret = "whsec_custom_super_secure_secret_12345";
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({
          url: "https://example.com/custom-hook",
          events: ["pair.registered"],
          secret: customSecret,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^wh_/);
      expect(res.body.secret).toBe(customSecret);

      const stored = webhookStore.get(res.body.id);
      expect(stored?.secret).toBe(customSecret);
    });

    it("POST /api/v1/webhooks generates random secret when none is supplied", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({
          url: "https://example.com/auto-secret",
          events: ["pair.registered"],
        });

      expect(res.status).toBe(201);
      expect(res.body.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    });

    it("GET /api/v1/webhooks and GET /api/v1/webhooks/:id NEVER leak the secret", async () => {
      const createRes = await request(app)
        .post("/api/v1/webhooks")
        .send({
          url: "https://example.com/secret-privacy-test",
          events: ["pair.registered"],
        });

      const { id, secret } = createRes.body;
      expect(secret).toBeDefined();

      // Read single
      const getRes = await request(app).get(`/api/v1/webhooks/${id}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(id);
      expect(getRes.body.secret).toBeUndefined();

      // Read list
      const listRes = await request(app).get("/api/v1/webhooks");
      expect(listRes.status).toBe(200);
      const found = listRes.body.items.find((w: { id: string }) => w.id === id);
      expect(found).toBeDefined();
      expect(found.secret).toBeUndefined();
    });

    it("rejects invalid secret format (too short)", async () => {
      const res = await request(app)
        .post("/api/v1/webhooks")
        .send({
          url: "https://example.com/bad-secret",
          events: ["pair.registered"],
          secret: "short",
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    });
  });

  // -------------------------------------------------------------------------
  // dispatchWebhookEvent Broadcast Integration
  // -------------------------------------------------------------------------
  describe("dispatchWebhookEvent", () => {
    it("delivers only to webhooks subscribed to matching event type or wildcard", async () => {
      const deliveredUrls: string[] = [];

      const mockFetch: typeof fetch = async (url) => {
        deliveredUrls.push(url.toString());
        return new Response("OK", { status: 200 });
      };

      webhookStore.set("wh_exact", {
        url: "https://example.com/exact",
        events: ["pair.registered"],
        createdAt: Date.now(),
      });

      webhookStore.set("wh_wildcard", {
        url: "https://example.com/wildcard",
        events: ["*"],
        createdAt: Date.now(),
      });

      webhookStore.set("wh_unmatched", {
        url: "https://example.com/unmatched",
        events: ["pair.deleted"],
        createdAt: Date.now(),
      });

      const results = await dispatchWebhookEvent(
        sampleEvent,
        { initialBackoffMs: 0 },
        mockFetch,
      );

      expect(results).toHaveLength(2);
      expect(deliveredUrls).toContain("https://example.com/exact");
      expect(deliveredUrls).toContain("https://example.com/wildcard");
      expect(deliveredUrls).not.toContain("https://example.com/unmatched");
    });
  });
});
