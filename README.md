# stableroute-backend

API gateway, routing engine, and pricing service for [StableRoute](https://github.com/your-org/stableroute) — Stellar liquidity routing.

## What this repo contains

- **Express** REST API (TypeScript)
- **Health** and **quote** endpoints as a base for the routing engine and pricing service

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
   API: `http://localhost:3001` (or `PORT` env var).

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

`GET /api/v1/metrics` exposes Prometheus text metrics:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `stableroute_pairs_total` | gauge | none | Number of registered pairs. |
| `stableroute_paused` | gauge | none | `1` when the service is paused, otherwise `0`. |
| `stableroute_http_requests_total` | counter | `method`, `status` | Total HTTP responses by method and status code. |
| `stableroute_http_request_duration_seconds` | histogram | `method`, `status`, `le` | Request latency buckets in seconds. |
| `stableroute_rate_limited_total` | counter | none | Total `429` responses emitted by the rate limiter. |
| `stableroute_paused_responses_total` | counter | none | Total `503` responses emitted by the pause guard. |

Request metrics intentionally avoid raw paths, request bodies, IP addresses,
and headers so the endpoint does not expose high-cardinality or sensitive data.

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
Current targets: **statements ≥ 89%**, **branches ≥ 81%**, **functions ≥ 87%**,
**lines ≥ 89%**.

> **Note:** `server.ts` (24 lines of startup/teardown boilerplate) is excluded
> from coverage targets because importing it starts a server that keeps the
> event loop alive and prevents Jest from exiting. Once `server.ts` is
> refactored for testability, thresholds can be raised toward 95% per the
> original campaign requirements.

Generate a local coverage report:

```bash
npm run test:coverage
```

Coverage reports are uploaded as a CI artifact on every push/PR.

## License

MIT
