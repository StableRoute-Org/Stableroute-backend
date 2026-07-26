# Idempotency-Key contract

The `Idempotency-Key` request header lets callers safely retry create
operations without accidentally duplicating resources.  The backend keeps a
bounded, TTL-expiring in-memory cache of the first response for each unique
key so that a repeat of the same request replays the original response
verbatim — the handler is **not** invoked a second time.

> **The cache is purely in-memory.** A process restart discards every cached
> entry.  Clients MUST supply a fresh key for each unique operation and be
> prepared for a `409 idempotency_conflict` when reusing a key with a
> different payload.

---

## Header

| Field            | Value                      |
|------------------|----------------------------|
| Header name      | `Idempotency-Key`          |
| Required?        | No — a missing or invalid key is silently ignored (the endpoint behaves normally). |
| Accepted length  | 1–200 characters           |
| Accepted charset | Any ASCII string (1–200 bytes). Keys outside this range cause the middleware to pass through without caching. |

---

## Participating endpoints

The following **POST** endpoints are protected by the idempotency guard:

| Method | Path                          |
|--------|-------------------------------|
| POST   | `/api/v1/pairs`               |
| POST   | `/api/v1/api-keys`            |
| POST   | `/api/v1/webhooks`            |

All other mutating routes — including the routes listed below — do
**not** participate and ignore the `Idempotency-Key` header entirely:

| Method   | Path                                                              |
|----------|-------------------------------------------------------------------|
| POST     | `/api/v1/pairs/bulk`                                              |
| POST     | `/api/v1/quote/bulk`                                              |
| POST     | `/api/v1/pairs/:source/:destination/reset`                        |
| POST     | `/api/v1/api-keys/:prefix/rotate`                                 |
| POST     | `/api/v1/admin/pause`                                             |
| POST     | `/api/v1/admin/unpause`                                           |
| POST     | `/api/v1/admin/read-only`                                         |
| POST     | `/api/v1/admin/read-write`                                        |
| PATCH    | `/api/v1/pairs/:source/:destination/enabled`                      |
| PATCH    | `/api/v1/pairs/:source/:destination/{liquidity,max,min,fee_bps,rate}` |
| PATCH    | `/api/v1/webhooks/:id`                                            |
| PATCH    | `/api/v1/config`                                                  |
| DELETE   | `/api/v1/pairs/:source/:destination`                              |
| DELETE   | `/api/v1/api-keys/:prefix`                                        |
| DELETE   | `/api/v1/webhooks/:id`                                            |

---

## Semantics

### First request with a given key

1. The middleware derives a cache key: `METHOD:path:idempotency-key`.
2. A SHA-256 hash of `JSON.stringify(body ?? null)` is computed.
3. The request proceeds to the route handler.
4. The handler's JSON response (`status` + `body`) is captured and stored:
   `{ status, body, bodyHash, expiresAt }`.

### Repeat request — exact same body

1. The same cache key and body hash are computed.
2. A live cache entry is found and the body hash matches.
3. **The handler is skipped.** The stored `status` and `body` are returned
   to the caller verbatim, with the real `Content-Type: application/json`
   header.

### Repeat request — different body

1. The same cache key is found but the body hash **differs**.
2. The request is rejected with:

```
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "idempotency_conflict",
  "message": "Idempotency-Key reused with a different request body",
  "requestId": "…"
}
```

### Expired or evicted entry

If the cached entry has expired (TTL elapsed) or was evicted (cache at
capacity), the key is treated as fresh — the handler executes and a new
entry is stored.

### Key outside 1–200 characters

The middleware passes through without caching; the endpoint behaves as if
no `Idempotency-Key` header was sent.

---

## Cache behaviour

### TTL

Default: **24 hours**. Override via the `IDEMPOTENCY_TTL_MS` environment
variable (value in milliseconds).

```env
IDEMPOTENCY_TTL_MS=3600000   # 1 hour
```

### Bounding

Maximum entries: **10,000**. Override via `IDEMPOTENCY_CACHE_MAX`.

```env
IDEMPOTENCY_CACHE_MAX=50000   # allow up to 50,000 entries
```

When the cache reaches capacity the oldest entry (by insertion order) is
evicted to make room for a new one. Expired entries are pruned on every
write.

---

## Error code reference

The `idempotency_conflict` error code is part of the standard API error
envelope (see `docs/api.md`):

| Code                   | HTTP | When it is emitted                                        |
|------------------------|------|-----------------------------------------------------------|
| `idempotency_conflict` | 409  | A repeat request carries the same `Idempotency-Key` but a different request body. |
