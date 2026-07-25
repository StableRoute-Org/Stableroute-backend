# Rate limiting

Every request to the StableRoute API is subject to a per-IP sliding-window
rate limiter. This document describes the algorithm, configuration, response
headers, and recommended client behaviour.

---

## Algorithm

The rate limiter uses a **sliding-window** design with per-IP timestamp
buckets.

For each request:

1. The client IP is resolved from the request (see [Bucket keying](#bucket-keying)).
2. Timestamps older than `rateLimitWindowMs` are evicted from the bucket.
3. If the number of remaining (in-window) timestamps equals or exceeds
   `rateLimitPerWindow`, the request is **rejected** with `429 Too Many
   Requests`.
4. Otherwise the current timestamp is appended to the bucket and the request
   proceeds.

Because the window slides continuously (rather than resetting on a fixed
clock boundary), a burst of requests at the end of one clock-second cannot
cross over into the next window — the oldest entry simply falls out of the
window once its age exceeds `rateLimitWindowMs`.

A garbage-collection pass (`pruneExpiredRateBuckets`) runs at most once per
60 seconds to remove map entries whose **every** timestamp has aged out.
This bounds memory for clients that connect once and never return.

---

## Bucket keying

Buckets are stored in an in-memory `Map<string, number[]>` keyed by the
client IP address.

The IP is resolved by `resolveClientIp()` (`src/utils/clientIp.ts`), which
checks in order:

1. The first value in the `X-Forwarded-For` request header (when present).
2. `req.ip` — this reflects Express's `trust proxy` setting.
3. `req.socket.remoteAddress`.
4. Falls back to the literal string `"unknown"`.

**Production note:** If the service runs behind a reverse proxy (Nginx,
Cloudflare, AWS ALB, etc.), you **must** configure the `TRUST_PROXY`
environment variable so Express reads the correct client IP from the
last trusted proxy hop. Acceptable values:

| Value | Behaviour |
|-------|-----------|
| unset / empty / `"false"` | No trust; `req.ip` equals `req.socket.remoteAddress` |
| `"true"` | Trust the first proxy in the chain |
| `"1"` / `"2"` / … | Trust the nearest *N* proxies |
| `"loopback, linklocal, uniquelocal"` | Comma-separated address-list for fine-grained trust |

Without correct proxy trust, every request appears to come from the proxy's
internal IP and a single rate bucket is shared by all downstream clients.

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
