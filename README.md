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

## Quote bounds

Registered pairs can carry optional amount bounds through the pair metadata
endpoints:

- `PATCH /api/v1/pairs/:source/:destination/min` sets `minAmount`.
- `PATCH /api/v1/pairs/:source/:destination/max` sets `maxAmount`.
- `PATCH /api/v1/pairs/:source/:destination/liquidity` sets `liquidity`.

`GET /api/v1/quote` enforces those slots for registered pairs before returning a
route. A bound value of `"0"` means unset, so pairs without configured limits
continue to quote normally. Amounts below `minAmount` or above `maxAmount`
return `400 invalid_request`; amounts above `liquidity` return
`422 insufficient_liquidity`. All comparisons are performed with `BigInt` to
avoid precision loss for base-unit amounts.

`POST /api/v1/quote/bulk` keeps batch semantics: invalid or out-of-bounds items
are returned as per-item failures, for example
`{ "index": 0, "ok": false, "error": "out_of_bounds" }`, without rejecting the
whole batch.

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
