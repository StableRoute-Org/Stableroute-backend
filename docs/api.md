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
`X-Request-Id` request header that passes both the charset and length
checks below, it is echoed back verbatim; otherwise a fresh UUID v4 is
generated. The same id appears in the `requestId` field of every error
body, so logs and error responses can be correlated.

**Accepted format:** 1–200 characters drawn exclusively from the
conservative token charset `[A-Za-z0-9._-]`. Values containing control
characters (including CR `\r` / LF `\n`), spaces, or any other
non-token bytes are **not** echoed — a generated UUID v4 is used
instead, closing the header-injection and log-injection surface while
preserving correlation.

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
| `payload_too_large` | 413  | Request body exceeds the 100 KiB JSON limit.                                        |
| `rate_limited`      | 429  | More than 60 requests per 60 s from one IP. Sets `Retry-After: 60`. Disabled when `NODE_ENV=test`. See [Rate-limiter memory bounding](#rate-limiter-memory-bounding) for eviction behaviour. |
| `service_paused`    | 503  | Service is paused and a non-idempotent request was made (see Admin / pause).        |
| `internal_error`    | 500  | Unhandled exception; `message` carries the error text plus `method`/`path`.         |
| `not_acceptable`    | 406  | `Accept` header is present and excludes `application/json` (see Content negotiation). |
| `request_timeout`   | 503  | The request handler execution time exceeded the configured timeout deadline.       |

> **Pause behaviour:** while paused, all non-`GET`/`HEAD`/`OPTIONS`
> requests return `503 service_paused`, **except** `POST /api/v1/admin/unpause`,
> so an operator can always recover.

### Content negotiation

All versioned JSON API endpoints enforce HTTP content negotiation. If a
request carries an `Accept` header that neither includes `application/json`
nor any matching wildcard (`*/*` or `application/*`), the server responds with:

```
HTTP/1.1 406 Not Acceptable
Content-Type: application/json

{
  "error": "not_acceptable",
  "message": "This endpoint only produces application/json",
  "requestId": "…"
}
```

**Exempt routes** — the following paths bypass the guard because they serve
non-JSON content:

| Path | Content-Type |
|------|--------------|
| `GET /health` | `application/json` (monitoring-friendly, no restriction) |
| `GET /api/v1/metrics` | `text/plain` (Prometheus exposition format) |

**Accepted `Accept` values:**

| Value | Accepted? |
|-------|-----------|
| *(absent)* | Yes — defaults to JSON |
| `application/json` | Yes |
| `*/*` | Yes |
| `application/*` | Yes |
| `text/html` | No → `406` |
| `text/csv` | No → `406` |

### Security headers

Every response sets `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
`Strict-Transport-Security: max-age=31536000; includeSubDomains`.

### Rate-limiter memory bounding

The per-IP sliding-window rate limiter stores request timestamps in the
`rateBuckets` map (`src/stores.ts`). Without eviction every distinct
source IP that ever makes a request keeps a map entry forever, enabling a
slow memory-exhaustion attack via rotating or spoofed addresses.

Two eviction strategies bound the map's memory footprint:

1. **Idle eviction** — after each request the limiter prunes stale
   timestamps from the IP's bucket. If the bucket is now empty (all
   timestamps have aged out of the 60 s window) the map key is deleted
   entirely rather than writing back an empty array.

2. **IP-ceiling eviction** — the map is hard-capped at
   `RATE_BUCKETS_MAX_IPS` (50 000) tracked IPs. When a new IP would
   exceed the ceiling, the least-recently-active entry (insertion-order
   oldest) is evicted before the new key is inserted.

Both passes are implemented in the exported `evictRateBuckets` helper
(`src/index.ts`) so unit tests can exercise eviction logic directly,
independent of the Express middleware (which is disabled under
`NODE_ENV=test`).

Active clients are not affected: the 60-req / 60-s window and the
`429 rate_limited` + `Retry-After: 60` response are unchanged.

---

## Health & service info

### `GET /health`

Shallow liveness check.

- **Response 200:** `{ "status": "ok", "service": "stableroute-backend" }`

### `GET /api/v1/openapi.json`

Returns a minimal OpenAPI 3.0.3 document describing the available paths.

- **Response 200:** OpenAPI document (`{ openapi, info, paths }`).

### `GET /api/v1/version`

Lightweight build/version metadata. Unauthenticated and cheap — runs no health
checks and exposes only build identity.

- **Response 200:**
  ```json
  {
    "name": "stableroute-backend",
    "version": "0.1.0",
    "commit": "a1b2c3d",
    "buildTime": "2026-01-01T00:00:00Z",
    "node": "v20.0.0"
  }
  ```

`name`/`version` come from `package.json`; `commit`/`buildTime` come from the
`GIT_COMMIT`/`BUILD_TIME` env vars (each falling back to `"unknown"`); `node` is
`process.version`. No secrets are exposed.

```bash
curl http://localhost:3001/api/v1/version
```

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

### `HEAD /api/v1/pairs`

Returns the same `ETag`, `Content-Type`, and `Content-Length` headers as
`GET /api/v1/pairs` but with **no response body**. A well-behaved HTTP
cache can issue this request to learn the current ETag and body size
without transferring the full pairs list.

The ETag is computed from the same serialized body as the `GET` handler
via a shared helper, so the two values are always byte-identical.

- **Response 200:** empty body. Headers set: `ETag`, `Content-Type: application/json`,
  `Content-Length` (byte length of the equivalent GET body).
- **Response 304:** empty body, when the request's `If-None-Match` header
  matches the current ETag.

### `POST /api/v1/pairs`

Register (or refresh) a pair.

- **Body:** `{ "source": "USDC", "destination": "EURC" }`
- **Response 201:** first registration — `{ source, destination, registered: true }`.
- **Response 200:** idempotent re-registration of an existing pair (same body).
- **Errors:** `400 invalid_request` if `source`/`destination` are not 1–12
  char strings, if they are equal, or if either code begins with the
  reserved prefix `__health` (see [Reserved probe namespace](#reserved-probe-namespace) below).

#### Reserved probe namespace

The deep readiness probe (`GET /api/v1/health/deep`) uses a scratch entry in
the internal `pairMeta` store to verify read/write/delete round-trips. The
scratch key is a fixed sentinel (`HEALTH_PROBE_KEY`) prefixed with the NUL
control character (`\x00`), which is structurally impossible in any valid asset
code and therefore can never collide with operator data.

As an additional guard, `POST /api/v1/pairs` rejects any asset code that starts
with `__health` (case-sensitive). This prevents a caller from registering a pair
whose derived key could approximate the reserved namespace and be silently
deleted by a concurrent probe run.

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
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value, or
  `minAmount` exceeds the pair's current `liquidity` — see cross-field invariant below).

### `PATCH /api/v1/pairs/:source/:destination/max`

Set the maximum amount.

- **Body:** `{ "maxAmount": "1000000" }` — positive integer string (`/^[1-9][0-9]{0,38}$/`).
- **Response 200:** the updated metadata object.
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value).

### `PATCH /api/v1/pairs/:source/:destination/liquidity`

Set available liquidity.

- **Body:** `{ "liquidity": "500000" }` — non-negative integer string (`/^[0-9]{1,39}$/`).
- **Response 200:** the updated metadata object.
- **Errors:** `404 not_found` (unregistered); `400 invalid_request` (bad value, or
  `liquidity` would fall below the pair's current `minAmount` — see cross-field invariant below).

#### Cross-field invariant: `minAmount <= liquidity`

The backend enforces that a pair's `minAmount` never exceeds its `liquidity`.
Setting a minimum trade size larger than the available liquidity would produce a
pair that advertises a minimum it can never fill.

The invariant is checked using `BigInt` so that 39-digit base-unit strings (common
in stablecoin protocols) are compared exactly without `Number` precision loss.

**Rule:** `minAmount > liquidity` is rejected with `400 invalid_request` on both
`PATCH .../liquidity` and `PATCH .../min`.

**Unset carve-out:** a `liquidity` of `"0"` means "not yet configured / unbounded".
Pairs that have never had their liquidity set are **not** retroactively invalidated
against their `minAmount`. The invariant is only enforced when `liquidity` is a
non-zero value.

| Scenario | `liquidity` | `minAmount` | Accepted? |
|---|---|---|---|
| Normal | `"5000"` | `"100"` | Yes — min < liquidity |
| Equal | `"500"` | `"500"` | Yes — min == liquidity |
| Violation | `"100"` | `"999"` | No — `400` returned |
| Unset liquidity | `"0"` | `"999"` | Yes — liquidity is unset |

### `POST /api/v1/pairs/bulk`

Register many pairs in a single request. Each item is validated independently;
one bad item never fails the whole batch.

- **Body:** `{ "pairs": [ { "source": "USDC", "destination": "EURC" }, … ] }`
  — 1 to `config.bulkMaxItems` entries (default 100).
- **Response 200:** `{ "results": [ … ] }` where each result is either:
  - success: `{ "index": 0, "ok": true, "source": "USDC", "destination": "EURC", "registered": true }`
  - failure: `{ "index": 1, "ok": false, "error": "invalid_asset_code" | "same_asset" }`
- **Errors:** `400 invalid_request` if the `pairs` array is missing, empty, or
  exceeds `config.bulkMaxItems`.
- **Audit:** emits `pair.registered` or `pair.refreshed` for each successful item.

```bash
curl -X POST http://localhost:3001/api/v1/pairs/bulk \
  -H 'Content-Type: application/json' \
  -d '{"pairs":[{"source":"USDC","destination":"EURC"},{"source":"EURC","destination":"XLM"}]}'
```

### `POST /api/v1/pairs/:source/:destination/reset`

Reset all metadata for a registered pair back to factory defaults
(`feeBps: 0`, `minAmount: "0"`, `maxAmount: "0"`, `liquidity: "0"`).
Use this to undo a misconfigured `feeBps`, `maxAmount`, or other field
without unregistering the pair (which would emit spurious lifecycle
events).

- **Body:** none required.
- **Response 200:**
  ```json
  {
    "source": "USDC",
    "destination": "EURC",
    "feeBps": 0,
    "minAmount": "0",
    "maxAmount": "0",
    "liquidity": "0"
  }
  ```
- **Errors:** `404 not_found` if the pair is not registered;
  `503 service_paused` if the service is currently paused.
- **Audit:** emits a `pair.meta.reset` event in the event log.

---

## Quotes

### `GET /api/v1/quote`

Get a single route quote. All three params are query-string params.

- **Query:** `source_asset` (1–12 chars), `dest_asset` (1–12 chars),
  `amount` (positive integer string, no leading zero, `/^[1-9][0-9]{0,38}$/`).
- **Response 200:**
  ```json
  {
    "source_asset": "USDC",
    "dest_asset": "EURC",
    "amount": "10000",
    "estimated_rate": "1.0",
    "route": ["USDC", "EURC"],
    "feeBps": 30,
    "feeAmount": "30",
    "netAmount": "9970"
  }
  ```
- **Errors:** `400 invalid_request` if any param is missing, if assets are
  not 1–12 char strings, if `source_asset === dest_asset`, or if `amount`
  is not a valid positive integer string.

#### Fee breakdown fields

| Field        | Type   | Description                                                                                           |
|--------------|--------|-------------------------------------------------------------------------------------------------------|
| `feeBps`     | number | The fee rate applied in basis points (100 bps = 1 %). Sourced from the registered pair's metadata; defaults to `0` if no metadata exists. |
| `feeAmount`  | string | Absolute fee in base units as an integer string. Computed as `floor(amount × feeBps / 10000)`. Fees are rounded **down** (in the gateway's favour). |
| `netAmount`  | string | Amount the destination side receives after fees: `amount - feeAmount`. Always ≥ `0`. |

All fee arithmetic uses `BigInt` internally, so precision is preserved for
amounts above `Number.MAX_SAFE_INTEGER` (`~9 × 10¹⁵`).

##### Worked example

Pair `USDC→EURC` has `feeBps: 30` (0.3 %). Quoting `amount = "10000"`:

```
feeAmount = floor(10000 × 30 / 10000) = floor(3) = 3
netAmount = 10000 − 3 = 9997
```

Response:
```json
{
  "source_asset": "USDC",
  "dest_asset":   "EURC",
  "amount":       "10000",
  "estimated_rate": "1.0",
  "route":        ["USDC", "EURC"],
  "feeBps":       30,
  "feeAmount":    "3",
  "netAmount":    "9997"
}
```

> **Note:** `amount`, `estimated_rate`, and `route` are unchanged for
> backward compatibility. New integrations should use `netAmount` as the
> authoritative receivable figure.

### `GET /api/v1/quote/reverse`

Reverse quote: given a desired target output amount, compute the required gross input needed.

- **Query:** `source_asset` (1–12 chars), `dest_asset` (1–12 chars),
  `target_amount` (positive integer string, no leading zero, `/^[1-9][0-9]{0,38}$/`).
- **Response 200:**
  ```json
  {
    "source_asset": "USDC",
    "dest_asset": "EURC",
    "target_amount": "10000",
    "required_input": "10000",
    "estimated_rate": "1.0",
    "route": ["USDC", "EURC"]
  }
  ```
- **Errors:** `400 invalid_request` if any param is missing, if assets are invalid
  or equal, or if `target_amount` is not a valid positive integer string.

#### Reverse formula

Currently, the exact-output quote solver (`solveInput`) implements a 1:1 identity mapping (input equals target), but is structured so a fee/rate can be layered in later.

```bash
curl 'http://localhost:3001/api/v1/quote/reverse?source_asset=USDC&dest_asset=EURC&target_amount=10000'
```

### `POST /api/v1/quote/bulk`

Quote up to 100 items in one request. Invalid items are reported
per-item rather than failing the whole request.

- **Body:** `{ "items": [ { "source_asset": "USDC", "dest_asset": "EURC", "amount": "100" }, … ] }`
  (1–`config.bulkMaxItems` items).
- **Response 200:** `{ "results": [ … ] }` where each result is either
  `{ index, ok: true, source_asset, dest_asset, amount, estimated_rate }`
  or `{ index, ok: false, error: "invalid_item" }`.
- **Errors:** `400 invalid_request` if `items` is not an array of 1–`config.bulkMaxItems` entries.

```bash
curl -X POST http://localhost:3001/api/v1/quote/bulk \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"source_asset":"USDC","dest_asset":"EURC","amount":"1000"}]}'
```

---

## API keys

API keys are created server-side; the raw secret is returned **only**
once at creation and never again. List/delete operate on the first 8
characters (the prefix).

### `POST /api/v1/api-keys`

Create a new API key. The raw key is returned **once** at creation and never
again — store it securely.

- **Body:** `{ "label": "ci-runner", "scopes": ["pairs:write"] }`
  - `label` — required, 1–64 chars.
  - `scopes` — optional string array. Known scopes: `pairs:write`, `webhooks:write`,
    `keys:admin`. Omit `scopes` to create a read-only key (empty scope set).
- **Response 201:**
  ```json
  { "key": "srk_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", "label": "ci-runner" }
  ```
- **Errors:** `400 invalid_request` if `label` is missing or not 1–64 chars, or
  if `scopes` contains unknown values.

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"label":"ci-runner","scopes":["pairs:write"]}'
```

### `GET /api/v1/api-keys`

List all API keys. The raw key value is **never** returned.

- **Response 200:**
  ```json
  {
    "items": [
      { "prefix": "srk_a1b2", "label": "ci-runner", "createdAt": 1700000000000 },
      { "prefix": "srk_c3d4", "label": "old-key", "createdAt": 1699000000000, "rotatedAt": 1700000000000 }
    ]
  }
  ```
  Rotated predecessor records include a `rotatedAt` field.

```bash
curl http://localhost:3001/api/v1/api-keys
```

### `DELETE /api/v1/api-keys/:prefix`

Delete by the 8-character key prefix.

- **Response 204:** empty body on success.
- **Errors:** `404 not_found` if no key matches the prefix.

```bash
curl -X DELETE http://localhost:3001/api/v1/api-keys/srk_a1b2
```

### `POST /api/v1/api-keys/:prefix/rotate`

Rotate an API key without downtime. Mints a new `srk_` successor key inheriting
the predecessor's `label`. The predecessor remains valid for a grace window
(`ROTATION_GRACE_MS`, default 1 hour) so callers can cut over without downtime.

- **Path param:** `:prefix` — the 8-character prefix of the key to rotate.
- **Response 201:**
  ```json
  {
    "key": "srk_newkeyvalue0000000000000000000",
    "label": "ci-runner",
    "graceExpiresAt": 1700003600000
  }
  ```
  The new raw key is returned exactly once. `graceExpiresAt` is the epoch-ms
  deadline after which the predecessor key will stop working.
- **Errors:** `404 not_found` if no key matches the prefix.

```bash
curl -X POST http://localhost:3001/api/v1/api-keys/srk_a1b2/rotate
```

---

## Webhooks

### `POST /api/v1/webhooks`

- **Body:** `{ "url": "https://example.com/hook", "events": ["pair.registered"] }`.
  `url` must be `http(s)` and ≤ 2048 chars; `events` must be a non-empty
  array of strings.
- **Events limits:**
  - At most **20** entries per registration (`WEBHOOK_MAX_EVENTS`).
  - Each event name must be **≤ 128 characters** (`WEBHOOK_MAX_EVENT_LENGTH`).
  - Event names must not be blank or whitespace-only.
  - Event names must not start with a reserved prefix: `internal.`, `system.`,
    or `admin.` (reserved for internal StableRoute use).
  - Duplicate event names are **silently deduplicated** before storage.
- **Response 201:** `{ "id": "wh_<hex>", "url", "events" }`.
  The `events` array in the response reflects the deduplicated list.
- **Errors:** `400 invalid_request` if `url` is invalid, or if `events`
  violates any of the rules above.

### `GET /api/v1/webhooks`

List all registered webhooks.

- **Response 200:**
  ```json
  {
    "items": [
      {
        "id": "wh_a1b2c3d4e5f6a7b8",
        "url": "https://example.com/hook",
        "events": ["pair.registered"],
        "createdAt": 1700000000000
      }
    ]
  }
  ```

```bash
curl http://localhost:3001/api/v1/webhooks
```

### `GET /api/v1/webhooks/:id`

Read a single registered webhook by id.

- **Response 200:**
  ```json
  {
    "id": "wh_a1b2c3d4e5f6a7b8",
    "url": "https://example.com/hook",
    "events": ["pair.registered"],
    "createdAt": 1700000000000
  }
  ```
- **Errors:** `404 not_found` if no webhook has that id.

```bash
curl http://localhost:3001/api/v1/webhooks/wh_a1b2c3d4e5f6a7b8
```

### `PATCH /api/v1/webhooks/:id`

Update the subscribed `events` list for an existing webhook in place.

The `url` is immutable on PATCH — to change the destination, delete and
recreate the webhook.

- **Body:** `{ "events": ["pair.registered", "pair.unregistered"] }` — non-empty
  string array; duplicates are deduplicated before storage.
- **Response 200:** the updated webhook object (`{ id, url, events, createdAt }`).
- **Errors:** `404 not_found` if the webhook does not exist; `400 invalid_request`
  if `events` is missing, empty, or contains non-string values.

```bash
curl -X PATCH http://localhost:3001/api/v1/webhooks/wh_a1b2c3d4e5f6a7b8 \
  -H 'Content-Type: application/json' \
  -d '{"events":["pair.registered","pair.unregistered"]}'
```

### `DELETE /api/v1/webhooks/:id`

Delete a registered webhook.

- **Response 204:** empty body on success.
- **Errors:** `404 not_found` if no webhook has that id.

```bash
curl -X DELETE http://localhost:3001/api/v1/webhooks/wh_a1b2c3d4e5f6a7b8
```

---

## Admin

### `POST /api/v1/admin/pause`

Pause the service. While paused, all non-idempotent (`GET`/`HEAD`/`OPTIONS`)
requests return `503 service_paused`, except `POST /api/v1/admin/unpause` which
is always reachable so an operator can recover.

- **Response 200:** `{ "paused": true }`.
- **Audit:** emits an `admin.paused` event.

```bash
curl -X POST http://localhost:3001/api/v1/admin/pause
```

### `POST /api/v1/admin/unpause`

Resume the service. Always reachable even while paused.

- **Response 200:** `{ "paused": false }`.
- **Audit:** emits an `admin.unpaused` event.

```bash
curl -X POST http://localhost:3001/api/v1/admin/unpause
```

### `POST /api/v1/admin/read-only`

Enable read-only maintenance mode. Keeps reads and quotes flowing while
freezing all other mutations. Weaker than `paused` — if the service is also
paused, the pause guard (`503 service_paused`) takes precedence.

While read-only is active, allowed requests are:
- All `GET`/`HEAD`/`OPTIONS` requests.
- `POST /api/v1/quote`, `POST /api/v1/quote/reverse`, `POST /api/v1/quote/bulk`.
- `POST /api/v1/admin/read-write` (recovery path, always reachable).

All other mutating requests return `503 read_only_mode`.

- **Response 200:** `{ "readOnly": true }`.

```bash
curl -X POST http://localhost:3001/api/v1/admin/read-only
```

### `POST /api/v1/admin/read-write`

Disable read-only maintenance mode. Always reachable even while read-only is
active, so operators can never be locked out.

- **Response 200:** `{ "readOnly": false }`.

```bash
curl -X POST http://localhost:3001/api/v1/admin/read-write
```

### `GET /api/v1/admin/status`

Returns the current operational flags.

- **Response 200:** `{ "paused": false, "readOnly": false }`.

```bash
curl http://localhost:3001/api/v1/admin/status
```

---

## Observability

### `GET /api/v1/stats`

Aggregate statistics about the current service state.

- **Response 200:**
  ```json
  {
    "totalPairs": 5,
    "paused": false,
    "totalApiKeys": 2,
    "totalWebhooks": 1,
    "totalEvents": 42,
    "pairsWithFee": 3,
    "distinctAssets": 4
  }
  ```

| Field            | Description                                                           |
|------------------|-----------------------------------------------------------------------|
| `totalPairs`     | Number of currently registered pairs.                                 |
| `paused`         | Whether the service is currently paused.                              |
| `totalApiKeys`   | Number of API keys in the store (including rotated predecessors).     |
| `totalWebhooks`  | Number of registered webhooks.                                        |
| `totalEvents`    | Current number of entries in the audit event log.                     |
| `pairsWithFee`   | Count of pairs whose stored `feeBps > 0`.                             |
| `distinctAssets` | Number of unique asset codes appearing in any registered pair.        |

```bash
curl http://localhost:3001/api/v1/stats
```

### `GET /api/v1/metrics`

Prometheus exposition format.

- **Response 200:** `text/plain; version=0.0.4` body with the following gauges:

| Metric | Type | Description |
|--------|------|-------------|
| `stableroute_pairs_total` | gauge | Number of currently registered pairs. |
| `stableroute_paused` | gauge | `1` if the service is paused, `0` otherwise. |
| `stableroute_events_total` | gauge | Current size of the in-memory audit event log. |
| `stableroute_events_by_type{type="…"}` | gauge | Count of events in the audit log for each known event type (`pair.registered`, `pair.refreshed`, `pair.unregistered`). |

Label values in `stableroute_events_by_type` are escaped per the Prometheus
text-exposition rules (backslash, double-quote, and newline characters are
escaped). The series set is stable across scrapes — all known types are always
emitted even when their count is zero.

### `GET /api/v1/events`

Audit log (in-memory ring buffer). The maximum number of stored entries is
controlled by the `eventLogCap` config key (default 10 000; see
`PATCH /api/v1/config` below).

- **Query:**
  - `since` — epoch ms timestamp; only events with `ts >= since` are included (default `0`).
  - `limit` — maximum number of events to return, clamped to `[1, 10 000]` (default `100`).
  - `type` *(optional)* — filter results to events of exactly this type. Must be one of the
    canonical `EventType` values: `pair.registered`, `pair.refreshed`, `pair.unregistered`.
    When omitted all event types are returned. `since` and `limit` are applied after the
    type filter.
- **Response 200:** `{ "items": [ { "id", "ts", "type", "payload" } ] }`.
- **Errors:** `400 invalid_request` if `type` is supplied but is not one of the known event types.

**Example — fetch only `pair.unregistered` events in the last window:**

```bash
curl 'http://localhost:3001/api/v1/events?type=pair.unregistered&limit=50'
```

---

## Config

### `GET /api/v1/config`

- **Response 200:** `{ "config": { "rateLimitPerWindow", "rateLimitWindowMs", "bulkMaxItems", "eventLogCap" } }`.

### `PATCH /api/v1/config`

Update mutable config values at runtime. The writable keys are:

| Key                  | Description                                                                     | Constraints                         |
|----------------------|---------------------------------------------------------------------------------|-------------------------------------|
| `rateLimitPerWindow` | Maximum requests allowed per IP per `rateLimitWindowMs`.                       | Positive integer.                   |
| `rateLimitWindowMs`  | Sliding-window duration in milliseconds for the rate limiter.                   | Positive integer.                   |
| `bulkMaxItems`       | Maximum number of items accepted by `POST /api/v1/quote/bulk`.                 | Positive integer, ≤ 100 000.        |
| `eventLogCap`        | Maximum number of events kept in the in-memory ring buffer.                     | Positive integer, ≤ 1 000 000.      |

**`eventLogCap` behaviour:**
- The cap is enforced at write time in `recordEvent` — every call to
  `recordEvent` evicts the oldest entry if the buffer exceeds the configured
  value.
- When you lower `eventLogCap` via this endpoint the existing buffer is trimmed
  **immediately** (oldest-first) down to the new cap, so memory is released
  without waiting for the next write.
- Setting `eventLogCap` above `1 000 000` is rejected with `400
  invalid_request` to prevent unbounded memory allocation.

- **Body:** any subset of the writable keys, each a positive integer.
- **Response 200:** `{ "config": { … } }` with the merged config.
- **Errors:** `400 invalid_request` if a provided value is not a positive
  integer, or if `eventLogCap` exceeds 1 000 000, or if `bulkMaxItems`
  exceeds its absolute maximum.

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

Get a reverse quote (what input is needed to deliver exactly 10000 target output units):

```bash
curl 'http://localhost:3001/api/v1/quote/reverse?source_asset=USDC&dest_asset=EURC&target_amount=10000'
```

Bulk register pairs:

```bash
curl -X POST http://localhost:3001/api/v1/pairs/bulk \
  -H 'Content-Type: application/json' \
  -d '{"pairs":[{"source":"USDC","destination":"EURC"},{"source":"EURC","destination":"XLM"}]}'
```

Rotate an API key (use the 8-char prefix from `GET /api/v1/api-keys`):

```bash
curl -X POST http://localhost:3001/api/v1/api-keys/srk_a1b2/rotate
```

Enable read-only mode and then re-enable writes:

```bash
curl -X POST http://localhost:3001/api/v1/admin/read-only
curl -X POST http://localhost:3001/api/v1/admin/read-write
```

Check service operational status:

```bash
curl http://localhost:3001/api/v1/admin/status
```
