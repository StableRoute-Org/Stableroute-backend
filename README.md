# stableroute-backend

API gateway, routing engine, and pricing service for [StableRoute](https://github.com/your-org/stableroute) — Stellar liquidity routing.

## What this repo contains

- **Express** REST API (TypeScript)
- **Health** and **quote** endpoints as a base for the routing engine and pricing service

## API reference

See [docs/api.md](docs/api.md) for the complete endpoint and error-code
reference, including request/response shapes and `curl` examples.

### Pagination

Consistent pagination is supported across all four list endpoints:
- `GET /api/v1/pairs`
- `GET /api/v1/events`
- `GET /api/v1/api-keys`
- `GET /api/v1/webhooks`

#### Query Parameters

- `limit` (optional): The maximum number of items to return. Defaults to `100`. Clamped to `[1, 500]` for pairs, API keys, and webhooks, and `[1, 10000]` for events.
- `cursor` (optional): An opaque, base64-encoded string representing the pagination offset. Omit this parameter to retrieve the first page.

#### Response Envelope

All paginated endpoints return an object containing the items and a `nextCursor` property. The top-level key for the items list is `pairs` for the pairs endpoint, and `items` for the others:

**Pairs response:**
```json
{
  "pairs": [
    { "source": "USDC", "destination": "EURC" }
  ],
  "nextCursor": "Mw=="
}
```

**Others response (events, api-keys, webhooks):**
```json
{
  "items": [ ... ],
  "nextCursor": "Mw=="
}
```

If the collection is exhausted (i.e. there are no more items to fetch), `nextCursor` will be returned as `null`.

#### Error Handling

If an invalid or malformed cursor is supplied, the endpoints will reject the request with `400 invalid_request` and include the canonical `requestId`.

### API-key scopes

Every API key carries a `scopes` array that restricts what the key is authorized to do. The fixed scope catalog is:

| Scope            | Grants access to                                             |
| ---------------- | ------------------------------------------------------------ |
| `pairs:write`    | Create, update (metadata), and delete trading pairs          |
| `webhooks:write` | Register and revoke webhook subscriptions                    |
| `keys:admin`     | Create, rotate, and revoke API keys                          |

A key with an **empty `scopes` array** (the default when `scopes` is omitted at creation) is **read-only**: it can call any endpoint that does not require a scope, but is denied write operations with `403 forbidden`.

**Creating a scoped key:**
```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label": "pair-bot", "scopes": ["pairs:write"]}'
```

Response:
```json
{
  "key": "srk_...",
  "label": "pair-bot",
  "scopes": ["pairs:write"]
}
```

**Creating a read-only key (no scopes):**
```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label": "monitoring"}'
```

Response:
```json
{
  "key": "srk_...",
  "label": "monitoring",
  "scopes": []
}
```

Unknown scope strings are rejected at creation with `400 invalid_request`. Scopes are surfaced in the `GET /api/v1/api-keys` listing alongside prefix, label, and metadata; the raw key is never exposed.

#### `requireScope(scope)` middleware factory

`requireScope` is an Express middleware factory that protects a route by asserting the authenticated key carries a specific scope:

```typescript
import { requireScope } from "./index";

// Only keys with "pairs:write" may call this route
app.post("/api/v1/pairs", requireScope("pairs:write"), handler);
```

Behaviour:

- **Missing or invalid key** → `401 unauthorized`
- **Expired key** → `401 unauthorized`
- **Valid key missing the required scope** → `403 forbidden` with message `"this key is missing the required scope: <scope>"`
- **Valid key with the required scope** → calls `next()` and updates the key's `lastUsedAt` timestamp

The factory accepts any string from `SCOPE_CATALOG` (`pairs:write`, `webhooks:write`, `keys:admin`). Passing an unrecognized scope string to `requireScope` is legal (the middleware simply checks membership in the key's `scopes` array) but no valid key will ever carry it, so the route will always return `403` for authenticated callers — use this deliberately as a kill-switch if needed.

### API-key expiry and last-used tracking

- **Creation Expiry:** `POST /api/v1/api-keys` accepts an optional `expiresInSeconds` parameter (positive integer, max 31,536,000 / 1 year) in the request body. If specified, the server computes and stores an absolute epoch-ms expiration timestamp `expiresAt`. The response returns `expiresAt` along with the raw key and label.
- **Validity check:** Any expired key will be treated as invalid by the auth middleware (`requireScope`), returning a `401 unauthorized` error.
- **Last-used tracking:** When a key is successfully authenticated, its `lastUsedAt` timestamp is updated in the map.
- **List representation:** `GET /api/v1/api-keys` includes `expiresAt` and `lastUsedAt` (if present) for each key, helping operators clean up stale keys and manage key rotation schedules. The raw key is never exposed.

### API-key rotation

`POST /api/v1/api-keys/:prefix/rotate` rotates a key without downtime. It
locates the key by its 8-char prefix, mints a new `srk_` successor inheriting
the predecessor's `label`, and returns the new raw key exactly once (201 — never
logged). The predecessor is stamped with `rotatedAt` and a `graceExpiresAt`
deadline (`ROTATION_GRACE_MS`, default 1h) so both keys remain valid during the
overlap window, letting callers cut over gracefully. `GET /api/v1/api-keys`
surfaces `rotatedAt` on rotated predecessor records (raw keys are never
returned). An unknown prefix returns `404 not_found`.

### Idempotency

Mutating create endpoints — `POST /api/v1/api-keys`, `POST /api/v1/webhooks`, and `POST /api/v1/pairs` — support safe retries using the `Idempotency-Key` header:
- **`Idempotency-Key` header:** Any string between `1` and `200` characters. When present, the server caches the first response (status and body) and replays it verbatim on subsequent identical requests.
- **Conflict Handling:** Reusing the same `Idempotency-Key` with a different request body returns `409 idempotency_conflict`.
- **TTL & Expiry:** Cache entries expire after a configurable TTL (see `IDEMPOTENCY_TTL_MS`).
- **Cache Bounding:** The cache size is capped at `10,000` entries (configurable via `IDEMPOTENCY_CACHE_MAX`) to prevent unbounded memory growth. The oldest entries are evicted first if capacity is reached.
- When no `Idempotency-Key` is provided, requests behave normally without caching.

### Batch pair registration

`POST /api/v1/pairs/bulk` registers up to `config.bulkMaxItems` (default 100) asset pairs in a single request and returns a per-item result array. One invalid item never fails the whole batch.

**Request:**
```json
{
  "pairs": [
    { "source": "USDC", "destination": "EURC" },
    { "source": "xlm",  "destination": "usdc" }
  ]
}
```

**Response `200`:**
```json
{
  "results": [
    { "index": 0, "ok": true, "source": "USDC", "destination": "EURC", "registered": true },
    { "index": 1, "ok": true, "source": "XLM",  "destination": "USDC", "registered": true }
  ]
}
```

Per-item failure shape:
```json
{ "index": 2, "ok": false, "error": "invalid_asset_code" }
{ "index": 3, "ok": false, "error": "same_asset" }
```

- Asset codes are normalized to uppercase (same as the single-pair endpoint).
- A `pair.registered` event is recorded for new pairs; `pair.refreshed` for re-registrations.
- Returns `400 invalid_request` only when the top-level `pairs` array is missing, empty, or exceeds `bulkMaxItems`. Per-item errors are always reported inline.
- The endpoint is blocked in read-only mode (`503 read_only_mode`) and when the service is paused (`503 service_paused`).

## Architecture & request lifecycle

See [docs/architecture.md](docs/architecture.md) for the in-memory store model,
the Express middleware chain in execution order (with each layer's purpose and
rationale), a Mermaid request-flow diagram, and the canonical error envelope.

## Prerequisites

- Node.js 18+
- npm

## Setup (contributors)

1. Clone the repo and enter the directory:
   ```bash
   git clone <repo-url> && cd stableroute-backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build and test:
   ```bash
   npm run build
   npm test
   ```
4. Run locally:
   ```bash
   npm run dev
   ```
   API: `http://localhost:3001` (or `PORT` env var). See
   [Configuration](#configuration) for the full list of environment
   variables and how to use the `.env.example` template.

## Configuration

The backend is configured entirely through environment variables. The
table below lists every variable the code reads — there are no others.

| Variable             | Purpose                                                                                                                                                                          | Default    | Example                  |
|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|--------------------------|
| `PORT`               | TCP port the HTTP server binds to.                                                                                                                                               | `3001`     | `8080`                   |
| `NODE_ENV`           | Runtime mode. Setting it to `test` disables the rate limiter and per-request logging (used by Jest).                                                                             | _(unset)_  | `production`             |
| `LOG_LEVEL`          | Pino structured logger level for request and error logs. Logs are disabled when `NODE_ENV=test`.                                                                                 | `info`     | `debug`                  |
| `SHUTDOWN_GRACE_MS`  | Grace period in milliseconds before the shutdown handler forces `process.exit(1)` when `server.close()` is still draining. Must be a positive integer; invalid values use the default. | `10000`    | `30000`                  |
| `GIT_COMMIT`         | Commit SHA surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`.                                                                        | _(unset)_  | `a1b2c3d`                |
| `BUILD_TIME`         | Build timestamp surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`.                                                                   | _(unset)_  | `2026-01-01T00:00:00Z`   |
| `ALLOW_UNREGISTERED_QUOTES` | Set to `"true"` to allow quoting of unregistered asset pairs. By default, quotes for unregistered pairs are rejected with `404 pair_not_registered`. | `false` | `true` |
| `IDEMPOTENCY_TTL_MS` | TTL in milliseconds for the idempotency cache entries. | `86400000` (24h) | `3600000` (1h) |
| `IDEMPOTENCY_CACHE_MAX` | Maximum number of entries kept in the idempotency cache. | `10000` | `5000` |
| `PERSIST_PATH`       | File path for the JSON persistence snapshot. When set, hydrates stores on startup and saves them on mutations. Defaults to in-memory only. | _(unset)_ | `./snapshot.json` |

### Store persistence and snapshot format

When the `PERSIST_PATH` environment variable is set, the application hydrates its stores on startup and automatically saves a snapshot to that path whenever a mutation is made to `pairRegistry`, `pairMeta`, `apiKeyStore`, `webhookStore`, or `eventLog` (debounced by 100ms).

#### Atomic Writes & Security
- **Atomic Writes:** To prevent corruption (e.g., if the process crashes mid-write), the snapshot is written to a temporary file (`<PERSIST_PATH>.tmp`) and then atomically renamed to the final destination using `fs.renameSync`.
- **Restricted Permissions:** The snapshot file is created with restricted read/write permissions (`0o600` / owner-only) to secure sensitive credentials such as API keys.

#### Snapshot JSON Format
The snapshot file has the following JSON structure:
```json
{
  "pairRegistry": [
    "USDC::EURC"
  ],
  "pairMeta": [
    [
      "USDC::EURC",
      {
        "feeBps": 10,
        "minAmount": "1",
        "maxAmount": "100",
        "liquidity": "1000",
        "enabled": true,
        "rate": "1.08"
      }
    ]
  ],
  "apiKeyStore": [
    [
      "srk_examplekey",
      {
        "label": "My Key",
        "createdAt": 1710000000000,
        "scopes": ["write"],
        "expiresAt": 1720000000000
      }
    ]
  ],
  "webhookStore": [
    [
      "wh_example",
      {
        "url": "https://example.com/webhook",
        "events": ["pair.registered"],
        "createdAt": 1710000000000
      }
    ]
  ],
  "eventLog": [
    {
      "id": "893c5d63-5f09-4e89-9a7c-f1261d7b1b36",
      "ts": 1710000000000,
      "type": "pair.registered",
      "payload": {
        "source": "USDC",
        "destination": "EURC"
      }
    }
  ]
}
```

### Build/version endpoint

`GET /api/v1/version` returns lightweight, unauthenticated build identity so
operators can confirm which build is live during an incident:

```json
{ "name": "stableroute-backend", "version": "0.1.0", "commit": "a1b2c3d", "buildTime": "2026-01-01T00:00:00Z", "node": "v20.0.0" }
```

`name`/`version` come from `package.json`; `commit`/`buildTime` come from the
`GIT_COMMIT`/`BUILD_TIME` env vars (each falling back to `"unknown"`); `node`
is `process.version`. No health checks run and no secrets are exposed.

`.env.example` is the template for these variables. Copy it to `.env`
and edit the values for local development:

```bash
cp .env.example .env
```

`.env` is git-ignored (see `.gitignore`), so your local values are never
committed. The application does not auto-load `.env`; export the
variables into your shell (or use your process manager / `--env-file`)
before starting the server.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production server (`dist/index.js`) |
| `npm run dev` | Run with ts-node-dev (watch) |
| `npm test` | Run Jest tests |
| `npm run test:coverage` | Run Jest with coverage (`coverage/` output) |
| `npm run lint` | Run ESLint |

## CI/CD

On every push/PR to `main`, GitHub Actions runs:

- `npm ci`
- `npm run lint` — ESLint 9 flat config (`eslint.config.mjs`) targeting `src/**/*.ts`
- `npm run build`
- `npm test`
- `npm run test:coverage` — enforces Jest coverage thresholds (≥ 90 % statements/lines, ≥ 88 % functions, ≥ 80 % branches) and uploads the HTML + lcov report as a CI artifact (`coverage-report`, retained 14 days).

Ensure these all pass locally before pushing. To run lint locally:

```bash
npm run lint
```

## Deep readiness probe

`GET /api/v1/health/deep` is designed as a Kubernetes readiness probe. It reports:

- **`status`**: `"ok"` if all checks pass and the service is not paused;
  `"paused"` if the admin pause has been toggled; `"degraded"` if any required
  health check fails.
- **`checks[]`**: An array of `{ name, status, durationMs }` objects, one per
  dependency. Current checks:
  - `storage` — verifies the in-memory store can write and read back.
  - `clock` — verifies the system clock is producing post-epoch timestamps.
- **`uptimeSeconds`**, **`memory`** (rssMb, heapUsedMb), **`pid`**, **`node`** —
  kept for backward compatibility.

When any required check fails, the endpoint returns **503** with
`status: "degraded"`. When the service is paused it returns **200** with
`status: "paused"`. When all checks pass it returns **200** with
`status: "ok"`.

Checks are time-bounded (5s timeout via `AbortController`) so the probe
never hangs.

## Read-only maintenance mode

In addition to the full `paused` kill-switch, the backend supports a softer
**read-only** mode that keeps reads and quotes flowing while freezing other
mutations — useful during a migration.

- `POST /api/v1/admin/read-only` — enable read-only mode.
- `POST /api/v1/admin/read-write` — disable it (always reachable, so operators
  can never be locked out).
- `GET /api/v1/admin/status` returns `{ paused, readOnly }`.

While read-only is on (and not paused), `GET`/`HEAD`/`OPTIONS` and the quote
endpoints (`/api/v1/quote`, `/api/v1/quote/reverse`, `/api/v1/quote/bulk`)
succeed; every other mutating write is rejected with `503 read_only_mode` using
the canonical error body. `paused` is strictly stronger: when the service is
paused, the existing pause behavior (`503 service_paused`) wins.

## Quote amount bounds

Registered pairs can carry `minAmount`, `maxAmount`, and `liquidity` metadata
through the pair metadata PATCH endpoints. Quote handlers compare the parsed
base-unit amount with those values using `BigInt`; the string value `"0"` means
that bound is unset.

- `GET /api/v1/quote` returns `400 invalid_request` when `amount < minAmount`
  or `amount > maxAmount`.
- `GET /api/v1/quote` returns `422 insufficient_liquidity` when `amount`
  exceeds non-zero `liquidity`.
- `POST /api/v1/quote/bulk` keeps processing the batch and reports bound
  failures per item as `{ index, ok: false, error: "out_of_bounds" }`.

## OpenAPI spec

The OpenAPI document is the single source of truth in `src/openapi.ts`
(exported as `openApiSpec`). The `GET /api/v1/openapi.json` handler serves it
verbatim instead of an inline literal, so the spec can be imported by tests.

`src/__tests__/openapi.test.ts` includes a **route-drift guard** that walks the
Express router stack, converts each registered `/api/v1/...` route to its
OpenAPI templated form (`:param` → `{param}`), and asserts every discovered path
appears as a key in `openApiSpec.paths`. This makes it impossible to ship a new
endpoint without documenting it.

## Storage adapter

All persistent state is accessed through a pluggable `StorageAdapter` interface
defined in `src/store/adapter.ts`. The active backend is selected at startup via
the `STORAGE_BACKEND` environment variable:

| `STORAGE_BACKEND` | Adapter           | Durability                      |
|-------------------|-------------------|---------------------------------|
| `memory` (default) | `InMemoryAdapter` | State is lost on process restart. |
| `json-file`       | `JsonFileAdapter` | State is written to `STORAGE_FILE` (default `./stableroute-data.json`) and reloaded on startup, so the registry survives restarts. |

**Example — durable local dev:**

```bash
STORAGE_BACKEND=json-file STORAGE_FILE=./data/sr.json npm run dev
```

The `StorageAdapter` interface covers pairs, pair metadata, API keys, webhooks,
and events. Adding a new durable backend (e.g. SQLite) only requires
implementing the interface and registering the backend in the `createAdapter`
factory.

## In-memory stores

All runtime state lives in `src/stores.ts` — a typed module with explicit
accessors and a `resetStores()` helper for test isolation:

| Store              | Type                  | Purpose                                           |
| ------------------ | --------------------- | ------------------------------------------------- |
| `pairRegistry`     | `Set<string>`         | Registered `"SOURCE::DEST"` pair keys              |
| `pairMeta`         | `Map<string, PairMeta>` | Per-pair fee / amount / liquidity metadata        |
| `apiKeyStore`      | `Map<string, ApiKeyRecord>` | Generated API key records                     |
| `webhookStore`     | `Map<string, WebhookRecord>` | Registered webhook records                   |
| `eventLog`         | `AppEvent[]`          | Bounded ring-buffer of application events          |
| `rateBuckets`      | `Map<string, number[]>` | Per-IP sliding-window timestamps (rate limiter)  |
| `config`           | `Record<string, number>` | Tunable runtime config (rate limits, bulk caps)  |
| `paused`           | `boolean`             | Service-level pause flag                           |

Call `resetStores()` in test `beforeEach` / `afterEach` hooks to prevent
cross-test bleed. This function is not exposed via any HTTP route.

## Audit events

`GET /api/v1/events` returns the in-memory audit log. In addition to the pair
lifecycle events (`pair.registered`, `pair.refreshed`, `pair.unregistered`),
the following security-relevant mutations are recorded:

| Event             | Payload (no secrets)        |
| ----------------- | --------------------------- |
| `apikey.created`  | `{ prefix, label }`         |
| `apikey.deleted`  | `{ prefix }`                |
| `webhook.created` | `{ id, url }`               |
| `webhook.deleted` | `{ id }`                    |
| `admin.paused`    | `{}`                        |
| `admin.unpaused`  | `{}`                        |

Payloads never include secret material — the raw API key and any webhook
secret are deliberately excluded. The existing `EVENT_LOG_CAP` eviction applies
unchanged.

## Request correlation (`X-Request-Id`)

Every request is assigned a correlation id that is echoed in the `X-Request-Id`
response header and included as `requestId` in every JSON error body.

**Accepted format for inbound `X-Request-Id`:**
- Characters: `A–Z`, `a–z`, `0–9`, `.`, `_`, `-` (allowlist only — no control
  characters, spaces, CR, LF, or other non-token bytes).
- Length: 1–200 characters.

Values that pass this check are echoed back unchanged. Values that fail — including
anything containing CRLF sequences or other injection vectors — are silently
replaced with a freshly generated UUID v4. This prevents header-injection and
log-injection attacks.

## Error responses

Handlers use a shared `sendError` helper so 400/404/413/500-style responses keep the canonical `{ error, message, requestId }` shape. The request id is attached before JSON parsing, which keeps body-parser errors correlated with the `X-Request-Id` response header.

A request body that is not valid JSON is treated as a client error: the final
error handler maps the body-parser parse failure (`entity.parse.failed` /
`SyntaxError`) to `400 invalid_json` with a fixed, non-leaking message
(`request body is not valid JSON`) — the raw parser text and any stack trace are
never echoed. The `413 payload_too_large` mapping still takes precedence, and
genuinely unexpected errors continue to fall through to `500 internal_error`.

### Content-Type requirement for write requests

`POST`, `PATCH`, and `PUT` requests that include a body **must** declare:

```
Content-Type: application/json
```

The `charset` parameter is allowed (e.g. `application/json; charset=utf-8`).
Any other media type — or an absent `Content-Type` on a non-empty body — is
rejected before the route handler runs:

```
HTTP/1.1 415 Unsupported Media Type
Content-Type: application/json

{
  "error": "unsupported_media_type",
  "message": "Content-Type must be application/json",
  "requestId": "..."
}
```

`curl` example of a correctly formed request:

```bash
curl -X POST http://localhost:3001/api/v1/pairs \
  -H "Content-Type: application/json" \
  -d '{"source":"USDC","destination":"EURC"}'
```

**Exempted requests:**
- `GET`, `HEAD`, `DELETE`, and `OPTIONS` are never checked (they carry no
  request body by convention).
- Body-bearing methods with no `Content-Length` *and* no `Transfer-Encoding`
  are also passed through, since there is no payload to validate.

**Security invariant:** The `Content-Type: application/json` declaration does
not bypass the 100 kB body-size limit. `express.json()` runs *before* the
content-type guard, so an oversized body is rejected with `413 payload_too_large`
before the guard even fires — a forged content-type header cannot smuggle raw
bytes into a route handler.

### Strict body validation

Create (`POST`) and patch (`PATCH`) endpoints enforce an allowlist of permitted
top-level JSON body keys. A request whose body carries keys outside the
allowlist for that route is rejected with `400 invalid_request`, listing the
offending key names:

```json
{
  "error": "invalid_request",
  "message": "unknown field(s): someUnknownKey",
  "unknownKeys": ["someUnknownKey"],
  "requestId": "..."
}
```

An absent or empty body passes through unmodified. The check runs before
per-field validation, so invalid-key errors always take precedence. Own
enumerable keys (including `__proto__` or `constructor`) from the parsed JSON
are detected as unknown and never assigned onto objects, preventing prototype
pollution.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, branch naming, local checks, and PR expectations.

Quick checklist:

1. Fork the repo and create a branch from `main`.
2. Install deps, add tests for new behavior, keep `npm run build`, `npm run lint`, and `npm test` passing.
3. Open a PR; CI must be green.

## Coverage

Test coverage thresholds are enforced in CI via Jest's `coverageThreshold`.
Current targets: **statements ≥ 90%**, **branches ≥ 80%**, **functions ≥ 88%**,
**lines ≥ 90%**.

> **Note:** `server.ts` is now refactored into side-effect-free, exported
> functions (`createServer`, `registerSignalHandlers`, `start`) with the actual
> `app.listen` guarded by `require.main === module`. It can therefore be
> imported and exercised by `src/__tests__/server.test.ts` (it starts on an
> ephemeral port, serves `/health`, and closes cleanly) without keeping the
> event loop alive. The signal-handler shutdown body calls `process.exit`, so
> it is deliberately not invoked under test, which is why `server.ts` keeps a
> small amount of uncovered branch.

Generate a local coverage report:

```bash
npm run test:coverage
```

Coverage reports are uploaded as a CI artifact on every push/PR.

## Security

For the vulnerability disclosure process, supported versions, and the gateway
threat model (unauthenticated admin routes, wildcard CORS, webhook SSRF, and
more) see [SECURITY.md](SECURITY.md).

## License

MIT
