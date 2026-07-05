# stableroute-backend

API gateway, routing engine, and pricing service for [StableRoute](https://github.com/your-org/stableroute) — Stellar liquidity routing.

## What this repo contains

- **Express** REST API (TypeScript)
- **Health** and **quote** endpoints as a base for the routing engine and pricing service

## API reference

See [docs/api.md](docs/api.md) for the complete endpoint and error-code
reference, including request/response shapes and `curl` examples.

### API-key rotation

`POST /api/v1/api-keys/:prefix/rotate` rotates a key without downtime. It
locates the key by its 8-char prefix, mints a new `srk_` successor inheriting
the predecessor's `label`, and returns the new raw key exactly once (201 — never
logged). The predecessor is stamped with `rotatedAt` and a `graceExpiresAt`
deadline (`ROTATION_GRACE_MS`, default 1h) so both keys remain valid during the
overlap window, letting callers cut over gracefully. `GET /api/v1/api-keys`
surfaces `rotatedAt` on rotated predecessor records (raw keys are never
returned). An unknown prefix returns `404 not_found`.

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
| `SHUTDOWN_GRACE_MS`  | Grace period in milliseconds before the shutdown handler forces `process.exit(1)` when `server.close()` is still draining. Must be a positive integer; invalid values use the default. | `10000`    | `30000`                  |
| `GIT_COMMIT`         | Commit SHA surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`.                                                                        | _(unset)_  | `a1b2c3d`                |
| `BUILD_TIME`         | Build timestamp surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`.                                                                   | _(unset)_  | `2026-01-01T00:00:00Z`   |

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
