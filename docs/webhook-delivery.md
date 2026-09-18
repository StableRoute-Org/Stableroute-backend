# Webhook Delivery, HMAC Signing & Dead-Letter Queue (DLQ)

This document specifies the webhook delivery pipeline, cryptographic signing scheme, retry mechanics, and dead-letter queue (DLQ) operations (Issue #552).

---

## 1. Overview & Architecture

StableRoute emits domain and audit events (`pair.registered`, `pair.refreshed`, `pair.fee_updated`, `pair.deleted`, `webhook.created`, etc.) as state changes occur.

Subscribers register webhook endpoints via `POST /api/v1/webhooks`. When matching events occur:
1. Payloads are signed with an HMAC-SHA256 signature containing a timestamp to prevent tampering and replay attacks.
2. Delivery is attempted with bounded retries and exponential backoff on transient errors (HTTP 5xx, timeouts, network failures).
3. If delivery attempts are exhausted or a non-retryable client error (HTTP 4xx) is encountered, the event is enqueued into the in-memory Dead-Letter Queue (DLQ).
4. Operators can inspect failed deliveries via the Dead-Letter Queue API and replay them once subscriber outages are resolved.

---

## 2. HMAC-SHA256 Signature Specification

Each webhook request delivered by StableRoute carries cryptographic authentication headers:

| Header | Description | Format / Example |
| :--- | :--- | :--- |
| `X-Signature` | Combined timestamp and hex signature | `t=1726612800000,v1=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08` |
| `X-Signature-Timestamp` | Epoch millisecond timestamp | `1726612800000` |
| `X-Event-Type` | The canonical event type name | `pair.registered` |
| `X-Event-Id` | Unique event UUID | `evt_3f89e2...` |

### Signing Algorithm
1. The signature timestamp `t` is obtained (epoch milliseconds).
2. A signing input string is formatted as: `${t}.${rawJsonPayload}`.
3. The HMAC-SHA256 is computed using the subscriber's secret:
   ```typescript
   const signature = createHmac("sha256", secret).update(`${t}.${rawPayload}`).digest("hex");
   ```
4. The header is constructed as: `t=${t},v1=${signature}`.

### Verifying Signatures in Subscribers
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = signatureHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp = parseInt(tPart.slice(2), 10);
  const signature = v1Part.slice(3);

  // Replay protection: check timestamp freshness
  if (toleranceSeconds > 0) {
    const ageSeconds = (Date.now() - timestamp) / 1000;
    if (Math.abs(ageSeconds) > toleranceSeconds) return false;
  }

  // Tamper check: compute expected HMAC
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
```

---

## 3. Retry Policy & Exponential Backoff

- **Max Retries**: Default 3 attempts (configurable via `WebhookDeliveryOptions.maxRetries`).
- **Initial Backoff**: Default 100ms (configurable via `WebhookDeliveryOptions.initialBackoffMs`).
- **Backoff Factor**: Default 2x multiplier per attempt:
  - Attempt 1: Immediate
  - Attempt 2: Wait 100ms
  - Attempt 3: Wait 200ms
- **Request Timeout**: Default 5000ms.
- **Payload Cap**: Default 64 KB (65,536 bytes). Oversized payloads are moved immediately to the DLQ without sending.
- **Classification**:
  - `2xx Success`: Delivery completed; handler acknowledged receipt.
  - `4xx Client Error`: Non-retryable (bad request, authentication failure, not found); halted immediately and moved to DLQ.
  - `5xx Server Error` / Timeout: Retryable; backed off exponentially until `maxRetries` is exhausted, then moved to DLQ.

---

## 4. Dead-Letter Queue (DLQ) API

The in-memory Dead-Letter Queue stores failed delivery events with their failure reason and attempt count. The queue is bounded to 1,000 entries (oldest-first LRU eviction).

### Endpoints

#### `GET /api/v1/webhooks/dead-letter`
List dead-lettered events.
- **Query parameters**:
  - `webhookId` (string, optional): Filter by webhook ID.
  - `limit` (integer, optional): Maximum items to return (default 100, max 1000).
- **Response `200 OK`**:
  ```json
  {
    "items": [
      {
        "id": "dlq_9f81a7b489c2",
        "webhookId": "wh_a1b2c3d4",
        "url": "https://subscriber.example.com/events",
        "event": {
          "id": "evt_001",
          "ts": 1726612800000,
          "type": "pair.registered",
          "payload": { "source": "USDC", "destination": "EURC" }
        },
        "attempts": 3,
        "lastError": "Destination responded with HTTP 503",
        "lastStatusCode": 503,
        "createdAt": 1726612801000,
        "lastAttemptAt": 1726612801500
      }
    ],
    "total": 1
  }
  ```

#### `GET /api/v1/webhooks/dead-letter/:id`
Retrieve a single dead-letter record by its `dlq_...` ID.
- **Response `200 OK`**: Returns the `DeadLetterRecord`.
- **Response `404 Not Found`**: When ID does not exist.

#### `POST /api/v1/webhooks/dead-letter/:id/replay`
Attempt re-delivery of a dead-lettered event.
- If re-delivery succeeds:
  - Event is removed from the DLQ.
  - Returns `200 OK` with `{ id, replayed: true, result }`.
- If re-delivery fails:
  - Event remains in DLQ; attempt count and `lastError` are updated.
  - Returns `502 Bad Gateway` with `{ id, replayed: false, error, result }`.

#### `DELETE /api/v1/webhooks/dead-letter/:id`
Purge an unrecoverable event from the DLQ.
- **Response `200 OK`**: `{ id, deleted: true }`.
- **Response `404 Not Found`**: When ID does not exist.

---

## 5. Security & Privacy Guarantees

- **Secret Confidentiality**: Webhook secrets are returned **only once** upon registration (`POST /api/v1/webhooks` 201 response). They are omitted from `GET /api/v1/webhooks`, `GET /api/v1/webhooks/:id`, and `PATCH /api/v1/webhooks/:id`.
- **SSRF Defense**: Target URLs must pass public IP and hostname validation (`isSafeWebhookUrl`). Loopback, private ranges, link-local, and cloud metadata IPs (`169.254.169.254`) are strictly rejected.
- **Memory Bounding**: Both event logs and the dead-letter queue are capped in memory with oldest-first eviction.
