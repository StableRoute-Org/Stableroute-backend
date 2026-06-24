# StableRoute Backend — API Reference

Complete reference for every HTTP endpoint exposed by the StableRoute
backend (`src/index.ts`). The service is an in-memory Express API; state
resets on process restart.

Base URL (local): `http://localhost:3001`

All paths below are absolute. Versioned endpoints live under
`/api/v1`; `/health` is unversioned.

---

## Conventions

### Correlation header

Every response carries an `X-Request-Id` header. If the caller sends an
`X-Request-Id` request header (≤ 200 chars) it is echoed back; otherwise
a fresh UUID v4 is generated. The same id appears in the `requestId`
field of every error body, so logs and error responses can be
correlated.

### Error envelope

All error responses share a single canonical JSON shape:

```json
{
  "error": "invalid_request",
  "message": "human-readable explanation",
  "requestId": "0f8c…-uuid"
}
```

Some errors include extra fields (e.g. the `500` handler adds `method`
and `path`), but `error`, `message`, and `requestId` are always present.

### Error codes

| Code                | HTTP | When it is emitted                                                                 |
|---------------------|------|------------------------------------------------------------------------------------|
| `invalid_request`   | 400  | Request validation failed (missing/invalid params or body).                        |
| `not_found`         | 404  | Resource does not exist, or no route matches the method + path.                    |
| `pair_not_registered` | 404 | Quote requested for a source/destination pair that was not registered first.       |
| `payload_too_large` | 413  | Request body exceeds the 100 KiB JSON limit.                                        |
| `rate_limited`      | 429  | More than 60 requests per 60 s from one IP. Sets `Retry-After: 60`. Disabled when `NODE_ENV=test`. |
| `service_paused`    | 503  | Service is paused and a non-idempotent request was made (see Admin / pause).        |
| `internal_error`    | 500  | Unhandled exception; `message` carries the error text plus `method`/`path`.         |

> **Pause behaviour:** while paused, all non-`GET`/`HEAD`/`OPTIONS`
> requests return `503 service_paused`, **except** `POST /api/v1/admin/unpause`,
> so an operator can always recover.

### Security headers

Every response sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
`Strict-Transport-Security: max-age=31536000; includeSubDomains`.

---

## Health & service info

### `GET /health`

Shallow liveness check.

- **Response 200:** `{ "status": "ok", "service": "stableroute-backend" }`

### `GET /api/v1/openapi.json`

Returns a minimal OpenAPI 3.0.3 document describing the available paths.

- **Response 200:** OpenAPI document (`{ openapi, info, paths }`).

### `GET /api/v1/health/deep`

Deep readiness probe. Runs synchronous `storage` and `clock` checks.

- **Response 200** (all checks pass, not paused), with body:
  ```json
  {
    "status": "ok",
    "uptimeSeconds": 42,
    "memory": { "rssMb": 70, "heapUsedMb": 20 },
    "pid": 1234,
    "node": "v18.0.0",
    "checks": [
      { "name": "storage", "status": "ok", "durationMs": 0 },
      { "name": "clock", "status": "ok", "durationMs": 0 }
    ]
  }
  ```
- **Response 200** with `status: "paused"` when the service is paused.
- **Response 503** with `status: "degraded"` and the same body shape when
  any check reports `status: "fail"`.

---

## Pairs

A pair is a `(source, destination)` tuple of asset codes. Asset codes are
1–12 character strings (Stellar's max alphanumeric asset code).

### `GET /api/v1/pairs`

List every registered pair. Supports conditional GET via a **weak ETag**.

- **Response 200:** `{ "pairs": [ { "source": "USDC", "destination": "EURC" }, … ] }`
  with an `ETag: W/"<base64 sha1 slice>"` header derived from the body.
- **Response 304:** empty body, when the request's `If-None-Match` header
  matches the current ETag.

### `POST /api/v1/pairs`

Register (or refresh) a pair.

- **Body:** `{ "source": "USDC", "destination": "EURC" }`
- **Response 201:** first registration — `{ source, destination, registered: true }`.
- **Response 200:** idempotent re-registration of an existing pair (same body).
- **Errors:** `400 invalid_request` if `source`/`destination` are not 1–12
  char strings, or if they are equal.

### `GET /api/v1/pairs/:source/:destination`

Read a single registered pair.

- **Response 200:** `{ source, destination, registered: true }`.
- **Errors:** `404 not_found` if the pair is not registered.

### `DELETE /api/v1/pairs/:source/:destination`

Unregister a pair.

- **Response 204:** empty body on success.
- **Errors:** `404 not_found` if the pair is not registered.

### `GET /api/v1/pairs/:source/:destination/info`

Aggregate read of the pair's registration state plus all per-pair
metadata in one round-trip. Returns defaults even for unregistered pairs.

- **Response 200:**
  ```json
  {
    "source": "USDC",
    "destination": "EURC",
    "registered": true,
    "feeBps": 0,
    "minAmount": "0",
    "maxAmount": "0",
    "liquidity": "0"
  }
  ```

### `PATCH /api/v1/pairs/:source/:destination/fee_bps`

Set the pair fee in basis points.

- **Body:** `{ "feeBps": 30 }` — integer in `[0, 1000]`.
- **Response 200:** `{ source, destination, feeBps, minAmount, maxAmount, liquidity }`.
- **Errors:** `404 not_found` if the pair is not registered;
  `400 invalid_request` if `feeBps` is not an integer in `[0, 1000]`.

### `PATCH /api/v1/pairs/:source/:destination/min`

Set the minimum amount.

- **Body:** `{ "minAmount": "100" }` — non-negative integer string (`/^[0-9]{1,39}$/`).
- **Response 200:** the updated metadata object.
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value).

### `PATCH /api/v1/pairs/:source/:destination/max`

Set the maximum amount.

- **Body:** `{ "maxAmount": "1000000" }` — positive integer string (`/^[1-9][0-9]{0,38}$/`).
- **Response 200:** the updated metadata object.
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value).

### `PATCH /api/v1/pairs/:source/:destination/liquidity`

Set available liquidity.

- **Body:** `{ "liquidity": "500000" }` — non-negative integer string (`/^[0-9]{1,39}$/`).
- **Response 200:** the updated metadata object.
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value).

---

## Quotes

### `GET /api/v1/quote`

Get a single route quote. All three params are query-string params.

- **Query:** `source_asset` (1–12 chars), `dest_asset` (1–12 chars),
  `amount` (positive integer string, no leading zero, `/^[1-9][0-9]{0,38}$/`).
- **Registration:** `source_asset` → `dest_asset` must be registered first with
  `POST /api/v1/pairs`, unless `ALLOW_UNREGISTERED_QUOTES=true` is set for
  demo compatibility.
- **Response 200:**
  ```json
  {
    "source_asset": "USDC",
    "dest_asset": "EURC",
    "amount": "100",
    "estimated_rate": "1.0",
    "route": ["USDC", "EURC"]
  }
  ```
- **Errors:** `400 invalid_request` if any param is missing, if assets are
  not 1–12 char strings, if `source_asset === dest_asset`, or if `amount`
  is not a valid positive integer string; `404 pair_not_registered` if the
  pair was not registered and demo compatibility is not enabled.

### `POST /api/v1/quote/bulk`

Quote up to 100 items in one request. Invalid items are reported
per-item rather than failing the whole request.

- **Body:** `{ "items": [ { "source_asset": "USDC", "dest_asset": "EURC", "amount": "100" }, … ] }`
  (1–100 items).
- **Response 200:** `{ "results": [ … ] }` where each result is either
  `{ index, ok: true, source_asset, dest_asset, amount, estimated_rate }`
  or `{ index, ok: false, error: "invalid_item" }` /
  `{ index, ok: false, error: "pair_not_registered", source_asset, dest_asset }`.
- **Errors:** `400 invalid_request` if `items` is not an array of 1–100 entries.

---

## API keys

API keys are created server-side; the raw secret is returned **only**
once at creation and never again. List/delete operate on the first 8
characters (the prefix).

### `POST /api/v1/api-keys`

- **Body:** `{ "label": "ci-runner" }` — 1–64 chars.
- **Response 201:** `{ "key": "srk_<hex>", "label": "ci-runner" }`.
- **Errors:** `400 invalid_request` if `label` is missing or not 1–64 chars.

### `GET /api/v1/api-keys`

- **Response 200:** `{ "items": [ { "prefix": "srk_abcd", "label": "…", "createdAt": 1700000000000 } ] }`.
  The raw `key` is **never** returned here.

### `DELETE /api/v1/api-keys/:prefix`

Delete by the 8-character key prefix.

- **Response 204:** empty body on success.
- **Errors:** `404 not_found` if no key matches the prefix.

---

## Webhooks

### `POST /api/v1/webhooks`

- **Body:** `{ "url": "https://example.com/hook", "events": ["pair.registered"] }`.
  `url` must be `http(s)` and ≤ 2048 chars; `events` must be a non-empty
  array of strings.
- **Response 201:** `{ "id": "wh_<hex>", "url", "events" }`.
- **Errors:** `400 invalid_request` if `url` is invalid, or if `events`
  is empty / not a string array.

### `GET /api/v1/webhooks`

- **Response 200:** `{ "items": [ { "id", "url", "events", "createdAt" } ] }`.

### `DELETE /api/v1/webhooks/:id`

- **Response 204:** empty body on success.
- **Errors:** `404 not_found` if no webhook has that id.

---

## Admin

### `POST /api/v1/admin/pause`

Pause the service. While paused, non-idempotent requests return
`503 service_paused` (except unpause).

- **Response 200:** `{ "paused": true }`.

### `POST /api/v1/admin/unpause`

Resume the service. Always allowed even while paused.

- **Response 200:** `{ "paused": false }`.

### `GET /api/v1/admin/status`

- **Response 200:** `{ "paused": false }`.

---

## Observability

### `GET /api/v1/stats`

- **Response 200:** `{ "totalPairs": 0, "paused": false }`.

### `GET /api/v1/metrics`

Prometheus exposition format.

- **Response 200:** `text/plain; version=0.0.4` body with
  `stableroute_pairs_total` and `stableroute_paused` gauges.

### `GET /api/v1/events`

Audit log (in-memory ring buffer, capped at 10 000 entries).

- **Query:** `since` (epoch ms, default `0`), `limit` (1–10 000, default `100`).
- **Response 200:** `{ "items": [ { "id", "ts", "type", "payload" } ] }`.

---

## Config

### `GET /api/v1/config`

- **Response 200:** `{ "config": { "rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems", "eventLogCap" } }`.

### `PATCH /api/v1/config`

Update mutable config values. Only `rateLimitPerWindow`,
`rateLimitWindowMs`, and `bulkMaxItems` are writable (`eventLogCap` is
read-only).

- **Body:** any subset of the writable keys, each a positive integer.
- **Response 200:** `{ "config": { … } }` with the merged config.
- **Errors:** `400 invalid_request` if a provided value is not a positive integer.

---

## `curl` examples

All examples use placeholder values — never put real keys in command
history.

Register a pair:

```bash
curl -X POST http://localhost:3001/api/v1/pairs \
  -H 'Content-Type: application/json' \
  -d '{"source":"USDC","destination":"EURC"}'
```

Set fee, min, max, and liquidity for a pair:

```bash
curl -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/fee_bps \
  -H 'Content-Type: application/json' -d '{"feeBps":30}'

curl -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/min \
  -H 'Content-Type: application/json' -d '{"minAmount":"100"}'

curl -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/max \
  -H 'Content-Type: application/json' -d '{"maxAmount":"1000000"}'

curl -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/liquidity \
  -H 'Content-Type: application/json' -d '{"liquidity":"500000"}'
```

Get a quote:

```bash
curl 'http://localhost:3001/api/v1/quote?source_asset=USDC&dest_asset=EURC&amount=100'
```

Create an API key (the `key` is shown only once — store it securely):

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"label":"my-service"}'
```

Register a webhook:

```bash
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hook","events":["pair.registered"]}'
```
