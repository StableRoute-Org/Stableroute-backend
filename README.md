# stableroute-backend

API gateway, routing engine, and pricing service for [StableRoute](https://github.com/your-org/stableroute) — Stellar liquidity routing.

## What this repo contains

- **Express** REST API (TypeScript)
- **Health** and **quote** endpoints as a base for the routing engine and pricing service

## API reference

See [docs/api.md](docs/api.md) for the complete endpoint and error-code
reference, including request/response shapes and `curl` examples.

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
3. Copy the environment configuration template:
   ```bash
   cp .env.example .env
   ```
   See [Configuration](#configuration) for details on available variables.
4. Build and test:
   ```bash
   npm run build
   npm test
   ```
5. Run locally:
   ```bash
   npm run dev
   ```
   API: `http://localhost:3001` (or `PORT` env var). See
   [Configuration](#configuration) for the full list of environment
   variables and how to use the `.env.example` template.

## Configuration

The backend is configured entirely through environment variables. The table below lists every environment variable the code currently reads — there are no others.

| Variable | Purpose | Default | Example |
|----------|---------|---------|---------|
| `PORT` | TCP port the HTTP server binds to. | `3001` | `8080` |
| `NODE_ENV` | Runtime mode (`development`, `production`, `test`). Setting `test` disables logging and rate limiting for Jest. | _(unset)_ | `production` |
| `LOG_LEVEL` | Pino logger verbosity level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`). | `info` | `debug` |
| `ADMIN_TOKEN` | Secret Bearer token required for administrative endpoints (`/api/v1/admin/*`). Requests are rejected if unset. | _(unset)_ | `dev-admin-secret-token` |
| `CORS_ALLOWED_ORIGINS` | Allowed origin(s) for Cross-Origin Resource Sharing (CORS). Supports single origin or comma-separated list. | `*` | `http://localhost:3000` |
| `TRUST_PROXY` | Express trust proxy setting (`loopback`, `linklocal`, `unroutable`, boolean, IP list, or hop count). | _(unset)_ | `loopback` |
| `ALLOW_UNREGISTERED_QUOTES` | Permit quote requests for asset pairs not explicitly registered in the pair registry (`true`/`false`). | `false` | `true` |
| `STORAGE_BACKEND` | Data persistence backend strategy (`memory` or `json-file`). | `memory` | `json-file` |
| `STORAGE_FILE` | File path for store persistence when `STORAGE_BACKEND=json-file`. | `./stableroute-data.json` | `./data/store.json` |
| `PERSIST_PATH` | File path for JSON store persistence adapter override. | _(unset)_ | `./stableroute-store.json` |
| `PAUSE_STATE_FILE` | Custom file path for persisting service pause state across restarts. | `./pause-state.json` | `./data/pause-state.json` |
| `REQUEST_TIMEOUT_MS` | Per-request timeout in milliseconds before responding with `503 request_timeout`. | `10000` | `15000` |
| `KEEP_ALIVE_TIMEOUT_MS` | HTTP server keep-alive socket timeout in milliseconds. | `5000` | `10000` |
| `HEADERS_TIMEOUT_MS` | HTTP server headers timeout in milliseconds. Should exceed `KEEP_ALIVE_TIMEOUT_MS`. | `61000` | `65000` |
| `IDEMPOTENCY_TTL_MS` | Time-to-live in milliseconds for cached idempotent request responses. | `86400000` | `43200000` |
| `IDEMPOTENCY_CACHE_MAX` | Maximum number of response entries stored in the idempotency LRU cache. | `10000` | `50000` |
| `SHUTDOWN_GRACE_MS` | Grace period in milliseconds given for active requests to finish before forced process exit. | `10000` | `15000` |
| `FLUSH_TIMEOUT_MS` | Timeout in milliseconds for flushing pending persistence operations during shutdown. | `5000` | `8000` |
| `GIT_COMMIT` | Commit SHA surfaced by `GET /api/v1/version`. Injected by deploy pipeline. | `unknown` | `a1b2c3d` |
| `BUILD_TIME` | Build ISO 8601 timestamp surfaced by `GET /api/v1/version`. Injected by deploy pipeline. | `unknown` | `2026-01-01T00:00:00Z` |

### Environment Template (`.env.example`)

[.env.example](.env.example) is the template for these variables. Copy it to `.env` and edit the values for local development:

```bash
cp .env.example .env
```

> **Note on Security & Git:** `.env` is git-ignored (see [.gitignore](.gitignore)), so your local `.env` file is never committed to version control. **Never commit `.env` or real production secrets.** `.env.example` contains safe placeholder defaults and inline comments for contributors.

Note that Node.js / Express does not automatically auto-load `.env` at runtime unless variables are exported into your shell, supplied via your process manager, or loaded using Node's `--env-file` flag.

### Build/version endpoint

`GET /api/v1/version` returns lightweight, unauthenticated build identity so
operators can confirm which build is live during an incident:

```json
{ "name": "stableroute-backend", "version": "0.1.0", "commit": "a1b2c3d", "buildTime": "2026-01-01T00:00:00Z", "node": "v20.0.0" }
```

`name`/`version` come from `package.json`; `commit`/`buildTime` come from the
`GIT_COMMIT`/`BUILD_TIME` env vars (each falling back to `"unknown"`); `node`
is `process.version`. No health checks run and no secrets are exposed.


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
