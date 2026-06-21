# StableRoute Backend API

This reference documents the HTTP surface implemented in `src/index.ts`.
Examples assume the local server is running at:

```bash
BASE=http://localhost:3001
```

## Common Behavior

### Request Ids

Every request receives an `X-Request-Id` response header. If the caller sends an
`X-Request-Id` header up to 200 characters, the API echoes it. Otherwise the API
generates a UUID.

```bash
curl -i -H "X-Request-Id: demo-1" "$BASE/health"
```

### Error Envelope

Explicit errors and middleware errors use this JSON shape:

```json
{
  "error": "invalid_request",
  "message": "human-readable detail",
  "requestId": "demo-1"
}
```

The generic 500 handler also includes `method` and `path`.

Common errors:

| Status | `error` | When |
|--------|---------|------|
| 400 | `invalid_request` | Request body, path, or query validation failed |
| 404 | `not_found` | Route or resource was not found |
| 413 | `payload_too_large` | JSON body exceeded the 100 KiB parser limit |
| 429 | `rate_limited` | More than 60 requests in 60 seconds from one IP |
| 500 | `internal_error` | Unhandled server error |
| 503 | `service_paused` | Non-read request while the service is paused |

### Operational Headers

| Header | When set | Notes |
|--------|----------|-------|
| `X-Request-Id` | Every response | Echoes the caller header or contains a generated UUID |
| `Retry-After` | Rate-limited responses | Currently `60` seconds |
| `ETag` | `GET /api/v1/pairs` 200 responses | Send it back as `If-None-Match` to receive `304` when unchanged |
| `X-Content-Type-Options` | Every response | `nosniff` |
| `X-Frame-Options` | Every response | `DENY` |
| `Referrer-Policy` | Every response | `no-referrer` |
| `Strict-Transport-Security` | Every response | `max-age=31536000; includeSubDomains` |

### Current Auth Status

The current Express implementation does not enforce authentication. Pair writes,
pair metadata updates, API-key management, webhook management, config writes, and
admin pause controls are operator surfaces and are expected to move behind auth
guards as those guards land.

## Health and Discovery

### `GET /health`

Shallow liveness check.

Success response:

```json
{
  "status": "ok",
  "service": "stableroute-backend"
}
```

Example:

```bash
curl "$BASE/health"
```

### `GET /api/v1/health/deep`

Readiness check with process metadata and synchronous dependency checks.

Success response:

```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "memory": { "rssMb": 64, "heapUsedMb": 12 },
  "pid": 12345,
  "node": "v22.0.0",
  "checks": [
    { "name": "storage", "status": "ok", "durationMs": 0 },
    { "name": "clock", "status": "ok", "durationMs": 0 }
  ]
}
```

Status semantics:

| Status field | HTTP status | Meaning |
|--------------|-------------|---------|
| `ok` | 200 | Service is not paused and checks passed |
| `paused` | 200 | Admin pause is enabled |
| `degraded` | 503 | At least one required check failed |

Example:

```bash
curl "$BASE/api/v1/health/deep"
```

### `GET /api/v1/openapi.json`

Returns a compact OpenAPI 3.0.3 document listing the implemented paths.

Example:

```bash
curl "$BASE/api/v1/openapi.json"
```

## Admin

### `POST /api/v1/admin/pause`

Enables the pause guard. While paused, non-read requests return
`503 service_paused`, except `POST /api/v1/admin/unpause`.

Success response:

```json
{ "paused": true }
```

Example:

```bash
curl -X POST "$BASE/api/v1/admin/pause"
```

### `POST /api/v1/admin/unpause`

Disables the pause guard.

Success response:

```json
{ "paused": false }
```

Example:

```bash
curl -X POST "$BASE/api/v1/admin/unpause"
```

### `GET /api/v1/admin/status`

Returns the current pause state.

Success response:

```json
{ "paused": false }
```

Example:

```bash
curl "$BASE/api/v1/admin/status"
```

## Metrics and Stats

### `GET /api/v1/metrics`

Returns Prometheus text exposition with pair count and pause state.

Success response:

```text
# HELP stableroute_pairs_total Number of registered pairs.
# TYPE stableroute_pairs_total gauge
stableroute_pairs_total 0
# HELP stableroute_paused 1 if paused, 0 otherwise.
# TYPE stableroute_paused gauge
stableroute_paused 0
```

Example:

```bash
curl "$BASE/api/v1/metrics"
```

### `GET /api/v1/stats`

Returns an aggregate in-memory snapshot.

Success response:

```json
{
  "totalPairs": 0,
  "paused": false
}
```

Example:

```bash
curl "$BASE/api/v1/stats"
```

## Pairs

Asset codes must be strings from 1 to 12 characters. Registration and quote
routes reject identical source and destination assets.

### `GET /api/v1/pairs`

Lists registered pairs.

Success response:

```json
{
  "pairs": [
    { "source": "USDC", "destination": "EURC" }
  ]
}
```

Headers:

- `ETag`: weak hash of the current response body.
- `304 Not Modified`: returned when `If-None-Match` matches the current `ETag`.

Examples:

```bash
curl -i "$BASE/api/v1/pairs"
curl -i -H 'If-None-Match: W/"previous-etag"' "$BASE/api/v1/pairs"
```

### `POST /api/v1/pairs`

Registers a source/destination pair.

Body:

```json
{
  "source": "USDC",
  "destination": "EURC"
}
```

Success responses:

- `201` for a new pair.
- `200` for an idempotent refresh of an existing pair.

```json
{
  "source": "USDC",
  "destination": "EURC",
  "registered": true
}
```

Errors:

- `400 invalid_request` when `source` or `destination` is not a 1-12 character string.
- `400 invalid_request` when `source` and `destination` are equal.

Example:

```bash
curl -X POST "$BASE/api/v1/pairs" \
  -H "Content-Type: application/json" \
  -d '{"source":"USDC","destination":"EURC"}'
```

### `GET /api/v1/pairs/{source}/{destination}`

Reads one registered pair.

Success response:

```json
{
  "source": "USDC",
  "destination": "EURC",
  "registered": true
}
```

Errors:

- `404 not_found` when the pair is not registered.

Example:

```bash
curl "$BASE/api/v1/pairs/USDC/EURC"
```

### `DELETE /api/v1/pairs/{source}/{destination}`

Unregisters one pair.

Success response:

- `204 No Content`

Errors:

- `404 not_found` when the pair is not registered.

Example:

```bash
curl -X DELETE "$BASE/api/v1/pairs/USDC/EURC"
```

### `GET /api/v1/pairs/{source}/{destination}/info`

Returns pair registration state plus metadata. This route returns default
metadata even for unregistered pairs.

Success response:

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

Example:

```bash
curl "$BASE/api/v1/pairs/USDC/EURC/info"
```

### `PATCH /api/v1/pairs/{source}/{destination}/fee_bps`

Sets the pair fee in basis points.

Body:

```json
{ "feeBps": 50 }
```

Validation:

- `feeBps` must be an integer from `0` to `1000`.
- Pair must already be registered.

Success response:

```json
{
  "source": "USDC",
  "destination": "EURC",
  "feeBps": 50,
  "minAmount": "0",
  "maxAmount": "0",
  "liquidity": "0"
}
```

Errors:

- `400 invalid_request` for invalid `feeBps`.
- `404 not_found` when the pair is not registered.

Example:

```bash
curl -X PATCH "$BASE/api/v1/pairs/USDC/EURC/fee_bps" \
  -H "Content-Type: application/json" \
  -d '{"feeBps":50}'
```

### `PATCH /api/v1/pairs/{source}/{destination}/min`

Sets the pair minimum amount.

Body:

```json
{ "minAmount": "100" }
```

Validation:

- `minAmount` must be a string of 1 to 39 digits.
- Pair must already be registered.

Errors:

- `400 invalid_request` for invalid `minAmount`.
- `404 not_found` when the pair is not registered.

Example:

```bash
curl -X PATCH "$BASE/api/v1/pairs/USDC/EURC/min" \
  -H "Content-Type: application/json" \
  -d '{"minAmount":"100"}'
```

### `PATCH /api/v1/pairs/{source}/{destination}/max`

Sets the pair maximum amount.

Body:

```json
{ "maxAmount": "1000000" }
```

Validation:

- `maxAmount` must be a positive integer string with 1 to 39 digits and no leading zero.
- Pair must already be registered.

Errors:

- `400 invalid_request` for invalid `maxAmount`.
- `404 not_found` when the pair is not registered.

Example:

```bash
curl -X PATCH "$BASE/api/v1/pairs/USDC/EURC/max" \
  -H "Content-Type: application/json" \
  -d '{"maxAmount":"1000000"}'
```

### `PATCH /api/v1/pairs/{source}/{destination}/liquidity`

Sets the pair liquidity amount.

Body:

```json
{ "liquidity": "5000000" }
```

Validation:

- `liquidity` must be a string of 1 to 39 digits.
- Pair must already be registered.

Errors:

- `400 invalid_request` for invalid `liquidity`.
- `404 not_found` when the pair is not registered.

Example:

```bash
curl -X PATCH "$BASE/api/v1/pairs/USDC/EURC/liquidity" \
  -H "Content-Type: application/json" \
  -d '{"liquidity":"5000000"}'
```

## Quotes

### `GET /api/v1/quote`

Returns a direct route quote.

Query parameters:

| Name | Required | Validation |
|------|----------|------------|
| `source_asset` | Yes | 1-12 character string |
| `dest_asset` | Yes | 1-12 character string; must differ from `source_asset` |
| `amount` | Yes | Positive integer string with no leading zero, up to 39 digits |

Success response:

```json
{
  "source_asset": "USDC",
  "dest_asset": "EURC",
  "amount": "100",
  "estimated_rate": "1.0",
  "route": ["USDC", "EURC"]
}
```

Errors:

- `400 invalid_request` for missing or invalid query parameters.

Example:

```bash
curl "$BASE/api/v1/quote?source_asset=USDC&dest_asset=EURC&amount=100"
```

### `POST /api/v1/quote/bulk`

Returns per-item quote results for a batch of 1 to 100 items.

Body:

```json
{
  "items": [
    { "source_asset": "USDC", "dest_asset": "EURC", "amount": "100" },
    { "source_asset": "USDC", "dest_asset": "USDC", "amount": "100" }
  ]
}
```

Top-level validation:

- `items` must be an array with 1 to 100 entries.

Per-item validation:

- Invalid item entries do not reject the whole request.
- Invalid entries return `{ "index": n, "ok": false, "error": "invalid_item" }`.

Success response:

```json
{
  "results": [
    {
      "index": 0,
      "ok": true,
      "source_asset": "USDC",
      "dest_asset": "EURC",
      "amount": "100",
      "estimated_rate": "1.0"
    },
    { "index": 1, "ok": false, "error": "invalid_item" }
  ]
}
```

Errors:

- `400 invalid_request` when `items` is missing, empty, or longer than 100 entries.

Example:

```bash
curl -X POST "$BASE/api/v1/quote/bulk" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"source_asset":"USDC","dest_asset":"EURC","amount":"100"}]}'
```

## Audit Events

### `GET /api/v1/events`

Returns an in-memory audit log of pair registration, refresh, and unregister
events.

Query parameters:

| Name | Default | Validation |
|------|---------|------------|
| `since` | `0` | Parsed with `Number`; returns events where `ts >= since` |
| `limit` | `100` | Clamped to at least `1` and at most `10000` |

Success response:

```json
{
  "items": [
    {
      "id": "uuid",
      "ts": 1710000000000,
      "type": "pair.registered",
      "payload": { "source": "USDC", "destination": "EURC" }
    }
  ]
}
```

Example:

```bash
curl "$BASE/api/v1/events?since=0&limit=100"
```

## API Keys

API keys are stored in memory. The create response returns the full key once;
list and delete use the first eight characters as the prefix.

### `GET /api/v1/api-keys`

Lists key metadata.

Success response:

```json
{
  "items": [
    { "prefix": "srk_abcd", "label": "worker", "createdAt": 1710000000000 }
  ]
}
```

Example:

```bash
curl "$BASE/api/v1/api-keys"
```

### `POST /api/v1/api-keys`

Creates an in-memory API key record.

Body:

```json
{ "label": "worker" }
```

Validation:

- `label` must be a non-empty string up to 64 characters.

Success response:

```json
{
  "key": "srk_generatedsecret",
  "label": "worker"
}
```

Errors:

- `400 invalid_request` for invalid `label`.

Example:

```bash
curl -X POST "$BASE/api/v1/api-keys" \
  -H "Content-Type: application/json" \
  -d '{"label":"worker"}'
```

### `DELETE /api/v1/api-keys/{prefix}`

Deletes the first key whose first eight characters match `prefix`.

Success response:

- `204 No Content`

Errors:

- `404 not_found` when no key matches the prefix.

Example:

```bash
curl -X DELETE "$BASE/api/v1/api-keys/srk_abcd"
```

## Webhooks

Webhook records are stored in memory.

### `GET /api/v1/webhooks`

Lists webhook records.

Success response:

```json
{
  "items": [
    {
      "id": "wh_abcdef1234567890",
      "url": "https://example.com/hook",
      "events": ["pair.registered"],
      "createdAt": 1710000000000
    }
  ]
}
```

Example:

```bash
curl "$BASE/api/v1/webhooks"
```

### `POST /api/v1/webhooks`

Creates a webhook record.

Body:

```json
{
  "url": "https://example.com/hook",
  "events": ["pair.registered"]
}
```

Validation:

- `url` must be an `http://` or `https://` string up to 2048 characters.
- `events` must be a non-empty array of strings.

Success response:

```json
{
  "id": "wh_abcdef1234567890",
  "url": "https://example.com/hook",
  "events": ["pair.registered"]
}
```

Errors:

- `400 invalid_request` for invalid `url` or `events`.

Example:

```bash
curl -X POST "$BASE/api/v1/webhooks" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook","events":["pair.registered"]}'
```

### `DELETE /api/v1/webhooks/{id}`

Deletes a webhook record.

Success response:

- `204 No Content`

Errors:

- `404 not_found` when the webhook id does not exist.

Example:

```bash
curl -X DELETE "$BASE/api/v1/webhooks/wh_abcdef1234567890"
```

## Runtime Config

### `GET /api/v1/config`

Returns mutable in-memory runtime configuration.

Success response:

```json
{
  "config": {
    "rateLimitPerWindow": 60,
    "rateLimitWindowMs": 60000,
    "bulkMaxItems": 100,
    "eventLogCap": 10000
  }
}
```

Example:

```bash
curl "$BASE/api/v1/config"
```

### `PATCH /api/v1/config`

Updates mutable config fields. Unknown keys are ignored. `eventLogCap` is
reported by `GET /api/v1/config` but is not mutable through this route.

Body:

```json
{
  "rateLimitPerWindow": 120,
  "rateLimitWindowMs": 60000,
  "bulkMaxItems": 100
}
```

Validation:

- Mutable fields must be positive integers.

Success response:

```json
{
  "config": {
    "rateLimitPerWindow": 120,
    "rateLimitWindowMs": 60000,
    "bulkMaxItems": 100,
    "eventLogCap": 10000
  }
}
```

Errors:

- `400 invalid_request` when a supplied mutable field is not a positive integer.

Example:

```bash
curl -X PATCH "$BASE/api/v1/config" \
  -H "Content-Type: application/json" \
  -d '{"rateLimitPerWindow":120}'
```

## Unknown Routes

Unknown routes return a canonical `404 not_found` body.

Example:

```bash
curl "$BASE/api/v1/not-real"
```
