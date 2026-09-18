# Rate limiting

Every request to the StableRoute API is subject to a fair, burst-resistant sliding-window
rate limiter scoped per tenant / API key (with graceful fallback to client IP). This document
describes the sub-window counter estimation algorithm, tenant keying, standard headers,
configuration, and error responses.

---

## Algorithm: Sliding Window Counter with Sub-Windows

The rate limiter employs a memory-efficient **sliding window counter** using prior and current sub-windows. Rather than storing every timestamp individually, the engine tracks request counts across the prior and active sub-windows:

$$\text{estimatedCount} = \left\lfloor \text{previousCount} \times \left(1 - \frac{\Delta t}{W}\right) + \text{currentCount} \right\rfloor$$

where:
- $W$ is `rateLimitWindowMs` (default 60,000 ms).
- $\Delta t$ is the elapsed duration within the current sub-window.
- $\text{previousCount}$ is the request volume in the immediately preceding window.
- $\text{currentCount}$ is the request volume in the current window.

### Anti-Burst Guarantee
Fixed-window limiters permit up to 2x the configured limit across window boundaries (e.g. sending 100% of the quota at $t = 0.95W$ and another 100% at $t = 1.05W$). The sliding-window weighted counter smoothly discounts the prior window's traffic as time elapses, ensuring total requests in any sliding interval $W$ never exceed the configured limit.

---

## Tenant & Key Scoping

Rate limits are strictly isolated per tenant / credential so that one tenant's burst cannot starve others. The limiter resolves request identity according to the following precedence:

1. **API Key Credential**:
   - `Authorization: Bearer <key>` or `X-API-Key: <key>`
   - Keyed as `key:<prefix>` where prefix is the non-secret 8-character lookup handle.
2. **Explicit Tenant Header**:
   - `X-Tenant-ID: <id>`
   - Keyed as `tenant:<id>`.
3. **Client IP Fallback**:
   - Resolved via `resolveClientIp()` from `X-Forwarded-For` or remote socket address.
   - Keyed as `ip:<clientIp>`.

Each distinct tenant, key prefix, or IP maintains its own independent budget.

---

## Response Headers

All HTTP responses emitted by StableRoute include standard rate-limiting metadata:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Total request allowance within the active window |
| `X-RateLimit-Remaining` | Remaining request quota in the current sliding window |
| `X-RateLimit-Reset` | Epoch timestamp (in seconds) when the active window resets |
| `Retry-After` *(on 429)* | Number of seconds the client must wait before retrying |

---

## Eviction

Three mechanisms keep memory bounded:

### 1. Idle expiry (`evictRateBuckets`)

Every time a bucket is accessed, timestamps that fall outside the current
window are filtered out. If **all** timestamps have aged out, the map entry
is deleted entirely. A returning IP starts with a fresh empty bucket.

### 2. IP ceiling (`RATE_BUCKETS_MAX_IPS`)

The map is capped at **10,000** distinct IPs (`RATE_BUCKETS_MAX_IPS` in
`src/stores.ts`). When a new IP arrives and the map is already at capacity,
the **oldest** map entry (by insertion order) is evicted before the new
bucket is populated. This bounds worst-case memory regardless of traffic
spray.

### 3. Lazy GC (`pruneExpiredRateBuckets`)

A background sweep runs inline (on the request path) at most once per 60
seconds. Any map entry whose **entire** timestamp array is expired is
removed. This handles the case where a client connects once, fills a
bucket, and never returns — the entry lingers until the next GC pass
rather than persisting forever.

---

## Configuration

Two keys in the runtime config object control the rate limiter:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `rateLimitPerWindow` | integer | `60` | Maximum requests allowed within the sliding window |
| `rateLimitWindowMs` | integer | `60000` | Window duration in milliseconds (60 s) |

Both are mutable at runtime via `PATCH /api/v1/config`. The rate-limit
middleware reads `config.rateLimitPerWindow` and `config.rateLimitWindowMs`
**on every request**, so changes take effect immediately — no restart
required.

```http
PATCH /api/v1/config
Content-Type: application/json

{ "rateLimitPerWindow": 30, "rateLimitWindowMs": 120000 }
```

Response (200):

```json
{
  "config": {
    "rateLimitPerWindow": 30,
    "rateLimitWindowMs": 120000,
    "bulkMaxItems": 100,
    "eventLogCap": 10000
  }
}
```

The current configuration can be inspected at any time with:

```http
GET /api/v1/config
```

---

## 429 response example

When a client exceeds the limit the API responds with:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
X-Request-Id: 9a8b7c6d-…-uuid

{
  "error": "rate_limited",
  "message": "more than 60 requests per 60s",
  "requestId": "9a8b7c6d-…-uuid"
}
```

The `Retry-After` header is set to `Math.ceil(windowMs / 1000)` seconds
— the full window duration. This gives clients a clear signal for when
the bucket is likely to have drained.

---

## Recommended client backoff

Clients should handle `429` responses with:

1. **Read `Retry-After`** — wait at least the number of seconds specified
   in the `Retry-After` header before retrying.
2. **Exponential backoff with jitter** — if the service is under sustained
   load, progressively increase the delay and add random jitter to avoid
   thundering-herd restamps:
   ```
   delay = min(cap, Retry-After * 2^attempt) * (0.5 + random() * 0.5)
   ```
3. **Log and monitor** — record 429s with the `requestId` and `Retry-After`
   value so operators can tune the rate limits if legitimate traffic is
   being throttled.

---

## Rate limiter and test mode

The rate-limit middleware is **disabled** when `NODE_ENV=test` so the test
suite can issue many requests without hitting the limit. The bucket logic
(`evictRateBuckets`) is exercised directly in unit tests.
