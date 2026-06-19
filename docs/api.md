# StableRoute Backend API

Base URL for local development: `http://localhost:3001`.

All JSON examples omit transport headers unless the header is part of the
behavior being documented.

## Operational Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `X-Request-Id` | request/response | Optional caller-provided correlation id. If omitted, the API generates one and echoes it on every response. Values longer than 200 characters are replaced. |
| `Retry-After` | response | Present on `429 rate_limited`; currently `60`. |
| `ETag` | response | Weak validator on `GET /api/v1/pairs`. |
| `If-None-Match` | request | Sends the pairs `ETag` back to receive `304 Not Modified` when unchanged. |
| `X-Content-Type-Options` | response | `nosniff`. |
| `X-Frame-Options` | response | `DENY`. |
| `Referrer-Policy` | response | `no-referrer`. |
| `Strict-Transport-Security` | response | `max-age=31536000; includeSubDomains`. |

## Error Envelope

Explicit handler errors and middleware errors use the same JSON shape:

```json
{
  "error": "invalid_request",
  "message": "human-readable detail",
  "requestId": "trace-id"
}
```

Some `500 internal_error` responses also include `method` and `path`.

Common errors:

| Status | `error` | When |
|--------|---------|------|
| `400` | `invalid_request` | Validation failure. |
| `404` | `not_found` | Unknown route or missing resource. |
| `413` | `payload_too_large` | JSON request body exceeds `100kb`. |
| `429` | `rate_limited` | More than 60 requests from one IP in 60 seconds outside `NODE_ENV=test`. |
| `500` | `internal_error` | Unhandled parse or server error. |
| `503` | `service_paused` | Non-idempotent request while the service is paused, except `/api/v1/admin/unpause`. |

## Health And Discovery

### `GET /health`

Shallow liveness probe.

Response `200`:

```json
{ "status": "ok", "service": "stableroute-backend" }
```

```bash
curl -i http://localhost:3001/health
```

### `GET /api/v1/health/deep`

Readiness probe with storage and clock checks.

Response `200` when healthy or paused, `503` when degraded:

```json
{
  "status": "ok",
  "uptimeSeconds": 12,
  "memory": { "rssMb": 80, "heapUsedMb": 12 },
  "pid": 12345,
  "node": "v20.0.0",
  "checks": [
    { "name": "storage", "status": "ok", "durationMs": 1 },
    { "name": "clock", "status": "ok", "durationMs": 0 }
  ]
}
```

```bash
curl -i http://localhost:3001/api/v1/health/deep
```

### `GET /api/v1/openapi.json`

Returns the lightweight OpenAPI route index emitted by the service.

```bash
curl -i http://localhost:3001/api/v1/openapi.json
```

## Runtime State

### `GET /api/v1/stats`

Returns aggregate in-memory state.

Response `200`:

```json
{ "totalPairs": 2, "paused": false }
```

```bash
curl -i http://localhost:3001/api/v1/stats
```

### `GET /api/v1/metrics`

Prometheus text exposition.

Response `200`, `Content-Type: text/plain; version=0.0.4`:

```text
stableroute_pairs_total 2
stableroute_paused 0
```

```bash
curl -i http://localhost:3001/api/v1/metrics
```

### `GET /api/v1/config`

Reads mutable runtime config.

Response `200`:

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

```bash
curl -i http://localhost:3001/api/v1/config
```

### `PATCH /api/v1/config`

Updates `rateLimitPerWindow`, `rateLimitWindowMs`, and/or `bulkMaxItems`.
Each supplied value must be a positive integer.

Request:

```json
{ "rateLimitPerWindow": 120, "rateLimitWindowMs": 30000, "bulkMaxItems": 50 }
```

Response `200`: same shape as `GET /api/v1/config`.

```bash
curl -i -X PATCH http://localhost:3001/api/v1/config \
  -H 'Content-Type: application/json' \
  -d '{"rateLimitPerWindow":120}'
```

## Pair Registry

Asset symbols must be single strings with 1-12 characters. The current
operator surfaces are not authenticated yet; planned admin guards should be
added before exposing them outside trusted environments.

### `GET /api/v1/pairs`

Lists registered pairs. Supports conditional requests with `If-None-Match`.

Response `200`:

```json
{ "pairs": [{ "source": "USDC", "destination": "EURC" }] }
```

Response `304`: empty body when `If-None-Match` matches.

```bash
curl -i http://localhost:3001/api/v1/pairs
curl -i http://localhost:3001/api/v1/pairs -H 'If-None-Match: W/"etag"'
```

### `POST /api/v1/pairs`

Registers a pair. First write returns `201`; repeated writes return `200` and
record a `pair.refreshed` audit event.

Request:

```json
{ "source": "USDC", "destination": "EURC" }
```

Response:

```json
{ "source": "USDC", "destination": "EURC", "registered": true }
```

```bash
curl -i -X POST http://localhost:3001/api/v1/pairs \
  -H 'Content-Type: application/json' \
  -d '{"source":"USDC","destination":"EURC"}'
```

### `GET /api/v1/pairs/:source/:destination`

Reads one registered pair.

Response `200`:

```json
{ "source": "USDC", "destination": "EURC", "registered": true }
```

```bash
curl -i http://localhost:3001/api/v1/pairs/USDC/EURC
```

### `DELETE /api/v1/pairs/:source/:destination`

Unregisters a pair and records `pair.unregistered`.

Response `204`: empty body.

```bash
curl -i -X DELETE http://localhost:3001/api/v1/pairs/USDC/EURC
```

### `GET /api/v1/pairs/:source/:destination/info`

Reads registration state plus metadata. Unregistered pairs return defaults.

Response `200`:

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

```bash
curl -i http://localhost:3001/api/v1/pairs/USDC/EURC/info
```

### `PATCH /api/v1/pairs/:source/:destination/fee_bps`

Sets `feeBps`, an integer in `[0, 1000]`.

```bash
curl -i -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/fee_bps \
  -H 'Content-Type: application/json' \
  -d '{"feeBps":50}'
```

### `PATCH /api/v1/pairs/:source/:destination/min`

Sets `minAmount`, a non-negative integer string.

```bash
curl -i -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/min \
  -H 'Content-Type: application/json' \
  -d '{"minAmount":"100"}'
```

### `PATCH /api/v1/pairs/:source/:destination/max`

Sets `maxAmount`, a positive integer string.

```bash
curl -i -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/max \
  -H 'Content-Type: application/json' \
  -d '{"maxAmount":"100000"}'
```

### `PATCH /api/v1/pairs/:source/:destination/liquidity`

Sets `liquidity`, a non-negative integer string.

```bash
curl -i -X PATCH http://localhost:3001/api/v1/pairs/USDC/EURC/liquidity \
  -H 'Content-Type: application/json' \
  -d '{"liquidity":"500000"}'
```

## Quotes

### `GET /api/v1/quote`

Query params:

| Name | Type | Rules |
|------|------|-------|
| `source_asset` | string | Asset code, 1-12 characters. |
| `dest_asset` | string | Asset code, 1-12 characters and different from `source_asset`. |
| `amount` | string | Positive integer string, no leading zero. |

Response `200`:

```json
{
  "source_asset": "USDC",
  "dest_asset": "EURC",
  "amount": "100",
  "estimated_rate": "1.0",
  "route": ["USDC", "EURC"]
}
```

```bash
curl -i 'http://localhost:3001/api/v1/quote?source_asset=USDC&dest_asset=EURC&amount=100'
```

### `POST /api/v1/quote/bulk`

Request body must contain `items`, an array of 1-100 quote requests. Invalid
items return per-item errors instead of failing the whole batch.

Request:

```json
{
  "items": [
    { "source_asset": "USDC", "dest_asset": "EURC", "amount": "100" }
  ]
}
```

Response `200`:

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
    }
  ]
}
```

```bash
curl -i -X POST http://localhost:3001/api/v1/quote/bulk \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"source_asset":"USDC","dest_asset":"EURC","amount":"100"}]}'
```

## API Keys

### `GET /api/v1/api-keys`

Lists stored API-key metadata without full key material.

Response `200`:

```json
{ "items": [{ "prefix": "srk_1234", "label": "ops", "createdAt": 1760000000000 }] }
```

```bash
curl -i http://localhost:3001/api/v1/api-keys
```

### `POST /api/v1/api-keys`

Creates an API key. `label` must be a non-empty string with at most 64
characters.

```bash
curl -i -X POST http://localhost:3001/api/v1/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"label":"ops"}'
```

### `DELETE /api/v1/api-keys/:prefix`

Deletes a key by its first 8 characters.

Response `204`: empty body.

```bash
curl -i -X DELETE http://localhost:3001/api/v1/api-keys/srk_1234
```

## Webhooks

### `GET /api/v1/webhooks`

Lists registered webhook endpoints.

```bash
curl -i http://localhost:3001/api/v1/webhooks
```

### `POST /api/v1/webhooks`

Registers a webhook. `url` must be `http` or `https`, at most 2048 characters;
`events` must be a non-empty string array.

```bash
curl -i -X POST http://localhost:3001/api/v1/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/stableroute","events":["pair.registered"]}'
```

### `DELETE /api/v1/webhooks/:id`

Deletes a webhook registration.

Response `204`: empty body.

```bash
curl -i -X DELETE http://localhost:3001/api/v1/webhooks/wh_1234
```

## Events

### `GET /api/v1/events`

Query params:

| Name | Default | Description |
|------|---------|-------------|
| `since` | `0` | Millisecond timestamp; returns events with `ts >= since`. |
| `limit` | `100` | Clamped to `[1, 10000]`; returns most recent matching events. |

Response `200`:

```json
{
  "items": [
    {
      "id": "uuid",
      "ts": 1760000000000,
      "type": "pair.registered",
      "payload": { "source": "USDC", "destination": "EURC" }
    }
  ]
}
```

```bash
curl -i 'http://localhost:3001/api/v1/events?limit=50&since=0'
```

## Admin Pause

These routes are currently operator surfaces and are planned to move behind an
admin guard.

### `POST /api/v1/admin/pause`

Sets pause state. While paused, non-idempotent requests return `503` except
`POST /api/v1/admin/unpause`.

```bash
curl -i -X POST http://localhost:3001/api/v1/admin/pause
```

### `POST /api/v1/admin/unpause`

Clears pause state.

```bash
curl -i -X POST http://localhost:3001/api/v1/admin/unpause
```

### `GET /api/v1/admin/status`

Reads pause state.

```bash
curl -i http://localhost:3001/api/v1/admin/status
```
