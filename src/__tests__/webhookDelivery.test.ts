import {
  signPayload,
  verifySignature,
  backoffDelay,
  deliverWebhook,
  listDeadLetter,
  clearDeadLetter,
  replayDeadLetter,
} from "../services/webhookDelivery";

const SECRET = "test-secret";

// ─── Mock fetch ───────────────────────────────────────────────────────────────

function mockFetch(
  responses: Array<{ status: number; ok: boolean }>,
  delay = 0,
): typeof fetch {
  let callIndex = 0;
  return (async (_url: URL | string, _init: RequestInit) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: `Status ${resp.status}`,
      headers: new Map(),
      json: async () => ({}),
      text: async () => "",
    } as Response;
  }) as typeof fetch;
}

// ─── Signing ──────────────────────────────────────────────────────────────────

describe("signPayload", () => {
  it("produces a t=...,v1=... header", () => {
    const sig = signPayload(1234567890, '{"test":true}', SECRET);
    expect(sig).toMatch(/^t=1234567890,v1=[0-9a-f]{64}$/);
  });

  it("produces deterministic signatures for the same input", () => {
    const sig1 = signPayload(1234567890, '{"test":true}', SECRET);
    const sig2 = signPayload(1234567890, '{"test":true}', SECRET);
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signPayload(1234567890, '{"a":1}', SECRET);
    const sig2 = signPayload(1234567890, '{"a":2}', SECRET);
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifySignature", () => {
  const body = '{"event":"test","payload":{"foo":"bar"}}';
  const timestamp = Math.floor(Date.now() / 1000);

  it("verifies a valid signature", () => {
    const sig = signPayload(timestamp, body, SECRET);
    expect(verifySignature(sig, body, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(timestamp, body, SECRET);
    expect(verifySignature(sig, '{"event":"test","payload":{"foo":"HACKED"}}', SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = signPayload(timestamp, body, SECRET);
    expect(verifySignature(sig, body, "wrong-secret")).toBe(false);
  });

  it("rejects an expired timestamp", () => {
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const sig = signPayload(oldTs, body, SECRET);
    expect(verifySignature(sig, body, SECRET, 300)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifySignature("garbage", body, SECRET)).toBe(false);
    expect(verifySignature("t=123", body, SECRET)).toBe(false);
    expect(verifySignature("v1=abc", body, SECRET)).toBe(false);
    expect(verifySignature("", body, SECRET)).toBe(false);
  });
});

// ─── Backoff ──────────────────────────────────────────────────────────────────

describe("backoffDelay", () => {
  it("increases exponentially with attempt number", () => {
    const d1 = backoffDelay(1);
    const d2 = backoffDelay(2);
    const d3 = backoffDelay(3);
    // Due to jitter, just check rough ordering
    expect(d1).toBeLessThanOrEqual(d2 + 5000); // jitter can cause overlap
    expect(d2).toBeLessThanOrEqual(d3 + 10000);
  });

  it("caps at MAX_BACKOFF_MS", () => {
    const d = backoffDelay(20); // very high attempt
    expect(d).toBeLessThanOrEqual(37500); // 30s + 25% jitter
  });
});

// ─── Delivery ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearDeadLetter();
});

describe("deliverWebhook", () => {
  const origBackoff = process.env.WEBHOOK_INITIAL_BACKOFF_MS;
  beforeEach(() => { process.env.WEBHOOK_INITIAL_BACKOFF_MS = "0"; });
  afterEach(() => { if (origBackoff === undefined) delete process.env.WEBHOOK_INITIAL_BACKOFF_MS; else process.env.WEBHOOK_INITIAL_BACKOFF_MS = origBackoff; });
  it("delivers successfully on first attempt (200)", async () => {
    const fetchImpl = mockFetch([{ status: 200, ok: true }]);
    const attempts = await deliverWebhook(
      "wh_test",
      "https://example.com/hook",
      "pair.registered",
      { pair: "XLM/USDC" },
      fetchImpl,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("success");
    expect(attempts[0].statusCode).toBe(200);
  });

  it("retries on 5xx then succeeds", async () => {
    const fetchImpl = mockFetch([
      { status: 503, ok: false },
      { status: 200, ok: true },
    ]);
    const attempts = await deliverWebhook(
      "wh_test",
      "https://example.com/hook",
      "pair.registered",
      { pair: "XLM/USDC" },
      fetchImpl,
    );
    expect(attempts.length).toBe(2);
    expect(attempts[0].status).toBe("retry");
    expect(attempts[0].statusCode).toBe(503);
    expect(attempts[1].status).toBe("success");
  });

  it("does not retry on 4xx (dead-letters immediately)", async () => {
    const fetchImpl = mockFetch([{ status: 404, ok: false }]);
    const attempts = await deliverWebhook(
      "wh_test",
      "https://example.com/hook",
      "pair.registered",
      {},
      fetchImpl,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("dead_letter");
    expect(attempts[0].statusCode).toBe(404);
    expect(listDeadLetter()).toHaveLength(1);
    expect(listDeadLetter()[0].failureReason).toContain("4xx");
  });

  it("retries on timeout/error then dead-letters after max attempts", async () => {
    process.env.WEBHOOK_MAX_ATTEMPTS = "2";
    // Always throws (simulating network failure)
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const attempts = await deliverWebhook(
      "wh_test",
      "https://example.com/hook",
      "pair.registered",
      {},
      fetchImpl,
    );
    delete process.env.WEBHOOK_MAX_ATTEMPTS;
    expect(attempts.length).toBe(2);
    expect(attempts[attempts.length - 1].status).toBe("dead_letter");
    expect(listDeadLetter()).toHaveLength(1);
    expect(listDeadLetter()[0].failureReason).toContain("exhausted");
  });

  it("signs each delivery attempt with X-Signature header", async () => {
    let receivedHeaders: Record<string, string> = {};
    const fetchImpl = (async (_url: URL | string, init: RequestInit) => {
      receivedHeaders = init.headers;
      return { ok: true, status: 200, statusText: "OK", headers: new Map(), json: async () => ({}), text: async () => "" } as Response;
    }) as typeof fetch;

    await deliverWebhook(
      "wh_test",
      "https://example.com/hook",
      "pair.registered",
      { data: 123 },
      fetchImpl,
    );

    expect(receivedHeaders["X-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(receivedHeaders["X-Webhook-Id"]).toBe("wh_test");
    expect(receivedHeaders["X-Webhook-Event"]).toBe("pair.registered");
  });

  it("dead-letters oversized payloads without sending", async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    const largePayload = { data: "x".repeat(200000) };
    await deliverWebhook("wh_test", "https://example.com/hook", "test.event", largePayload, fetchImpl);

    expect(fetchCalled).toBe(false);
    expect(listDeadLetter()).toHaveLength(1);
  });
});

// ─── Dead-letter queue ────────────────────────────────────────────────────────

describe("dead-letter queue", () => {
  it("lists dead-lettered entries", async () => {
    const fetchImpl = mockFetch([{ status: 500, ok: false }]);
    // Override max attempts to 1 for speed
    process.env.WEBHOOK_MAX_ATTEMPTS = "1";
    await deliverWebhook("wh_1", "https://example.com/hook", "test.event", {}, fetchImpl);

    const dlq = listDeadLetter();
    expect(dlq.length).toBeGreaterThan(0);
    expect(dlq[0].webhookId).toBe("wh_1");
    expect(dlq[0].eventType).toBe("test.event");
  });

  it("replays a dead-lettered entry successfully", async () => {
    // First, dead-letter it
    const failFetch = (async () => { throw new Error("fail"); }) as typeof fetch;
    await deliverWebhook("wh_2", "https://example.com/hook", "test.event", { x: 1 }, failFetch);

    const dlq = listDeadLetter();
    expect(dlq).toHaveLength(1);
    const dlqId = dlq[0].id;

    // Now replay with a working endpoint
    const successFetch = mockFetch([{ status: 200, ok: true }]);
    const attempts = await replayDeadLetter(dlqId, successFetch);

    expect(attempts).not.toBeNull();
    expect(attempts![attempts!.length - 1].status).toBe("success");

    // Entry should be removed from DLQ after successful replay
    expect(listDeadLetter().find((e) => e.id === dlqId)).toBeUndefined();
  });

  it("clears the dead-letter queue", async () => {
    const failFetch = (async () => { throw new Error("fail"); }) as typeof fetch;
    await deliverWebhook("wh_3", "https://example.com/hook", "test.event", {}, failFetch);

    expect(listDeadLetter().length).toBeGreaterThan(0);
    clearDeadLetter();
    expect(listDeadLetter()).toHaveLength(0);
  });
});
