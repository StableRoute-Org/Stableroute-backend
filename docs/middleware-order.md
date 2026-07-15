# HTTP middleware order

StableRoute backend (`src/index.ts`) applies middleware in this order:

1. **CORS** — configurable allowlist via environment.
2. **Request correlation** — assigns/propagates `X-Request-Id`.
3. **Security headers** — baseline hardening on all responses.
4. **Rate limiting** — per-IP buckets (disabled when `NODE_ENV=test`).
5. **Body parsers** — JSON with size limits; content-type guard on mutating verbs.
6. **Route handlers** — REST API under `/api/v1/*`.
7. **Error handler** — canonical `{ error, message, requestId }` envelope.

Pause/read-only guards run inside handlers that mutate router state.

See `docs/architecture.md` for store layout and event logging.
