# stableroute-backend

API gateway, routing engine, and pricing service for [StableRoute](https://github.com/your-org/stableroute) — Stellar liquidity routing.

## What this repo contains

- **Express** REST API (TypeScript)
- **Health** and **quote** endpoints as a base for the routing engine and pricing service

## API reference

See [docs/api.md](docs/api.md) for the complete endpoint and error-code
reference, including request/response shapes and `curl` examples.

### API-key scopes

`POST /api/v1/api-keys` accepts an optional `scopes` array drawn from a fixed
catalog: `pairs:write`, `webhooks:write`, `keys:admin`. Unknown scopes are
rejected with `400 invalid_request`. When `scopes` is omitted the key defaults
to a least-privilege, read-only set (no write scope). `GET /api/v1/api-keys`
surfaces each key's `scopes` (never the raw key).

The `requireScope(scope)` factory returns Express middleware that resolves the
key from the `Authorization: Bearer <srk_...>` header and asserts it carries the
required scope, responding `401 unauthorized` when no valid key is supplied and
`403 forbidden` when the key lacks the scope. Write routes can adopt it directly;
`GET /api/v1/api-keys/whoami` is a small probe guarded by `requireScope("keys:admin")`.

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

| Variable   | Purpose                                                                                              | Default       | Example       |
|------------|------------------------------------------------------------------------------------------------------|---------------|---------------|
| `PORT`     | TCP port the HTTP server binds to.                                                                   | `3001`        | `8080`        |
| `NODE_ENV` | Runtime mode. Setting it to `test` disables the rate limiter and per-request logging (used by Jest). | _(unset)_     | `production`  |
| `GIT_COMMIT` | Commit SHA surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`. | _(unset)_ | `a1b2c3d`     |
| `BUILD_TIME` | Build timestamp surfaced by `GET /api/v1/version`. Injected by the deploy pipeline; falls back to `"unknown"`. | _(unset)_ | `2026-01-01T00:00:00Z` |

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
| `npm run lint` | Run ESLint |

## CI/CD

On every push/PR to `main`, GitHub Actions runs:

- `npm ci`
- `npm run build`
- `npm test`

Ensure these pass locally before pushing.

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

## Metrics

`GET /api/v1/metrics` exposes Prometheus text exposition format
(`text/plain; version=0.0.4`). Alongside `stableroute_pairs_total` and
`stableroute_paused`, it emits label-free, constant-cardinality store-size and
config gauges:

| Metric                              | Source                          |
| ----------------------------------- | ------------------------------- |
| `stableroute_api_keys_total`        | Number of stored API keys.      |
| `stableroute_webhooks_total`        | Number of registered webhooks.  |
| `stableroute_event_log_size`        | Current event-log depth.        |
| `stableroute_rate_limit_per_window` | Configured requests per window. |

These carry no labels and never include raw secrets or URLs.

## OpenAPI spec

The OpenAPI document is the single source of truth in `src/openapi.ts`
(exported as `openApiSpec`). The `GET /api/v1/openapi.json` handler serves it
verbatim instead of an inline literal, so the spec can be imported by tests.

`src/__tests__/openapi.test.ts` includes a **route-drift guard** that walks the
Express router stack, converts each registered `/api/v1/...` route to its
OpenAPI templated form (`:param` → `{param}`), and asserts every discovered path
appears as a key in `openApiSpec.paths`. This makes it impossible to ship a new
endpoint without documenting it.

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

## Error responses

Handlers use a shared `sendError` helper so 400/404/413/500-style responses keep the canonical `{ error, message, requestId }` shape. The request id is attached before JSON parsing, which keeps body-parser errors correlated with the `X-Request-Id` response header.

### Strict request bodies

Create and patch endpoints reject request bodies that contain unknown top-level
keys with `400 invalid_request` (the response `unknownKeys` array lists the
offending fields). This covers `POST /api/v1/api-keys`, `POST /api/v1/webhooks`,
`POST /api/v1/pairs`, the four pair-meta `PATCH` routes, and `PATCH /api/v1/config`.
A typo'd or unexpected field is reported instead of silently dropped, and keys
like `__proto__` are surfaced as unknown rather than honoured. An absent or empty
body has no keys to reject.

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
