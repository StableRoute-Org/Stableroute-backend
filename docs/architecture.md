# Architecture and request lifecycle

## Contents

- [Scope](#scope)
- [In-memory store model](#in-memory-store-model)
- [Request lifecycle](#request-lifecycle)
- [Why middleware ordering matters](#why-middleware-ordering-matters)
- [Canonical error envelope](#canonical-error-envelope)
- [Where to add new middleware](#where-to-add-new-middleware)

## Scope

This document describes the current Express application assembled in
`src/index.ts`. It focuses on the in-memory state model, middleware registration
order, request/response flow, and error envelope that route handlers share.

The app is intentionally compact: all mutable runtime state currently lives in
process memory, and all middleware and routes are registered against a single
Express app instance exported from `src/index.ts`.

## In-memory store model

The backend mirrors gateway state with plain TypeScript data structures:

| Store | Shape | Purpose |
|-------|-------|---------|
| `rateBuckets` | `Map<string, number[]>` | Per-client sliding-window request timestamps for rate limiting. |
| `pairRegistry` | `Set<string>` | Registered `source::destination` pair keys. |
| `pairMeta` | `Map<string, PairMeta>` | Fee, min/max amount, and liquidity metadata for each pair. |
| `eventLog` | `AppEvent[]` | Recent in-memory events such as pair registration and unregistration. |
| `apiKeyStore` | `Map<string, ApiKeyRecord>` | Generated API keys and their metadata. |
| `webhookStore` | `Map<string, WebhookRecord>` | Webhook callback URLs and subscribed event names. |
| `config` | `Record<string, number>` | Runtime-tunable limits for rate limiting and bulk quote size. |
| `paused` | `boolean` | Operator pause state checked by the pause guard. |

Because these stores are process-local, a restart resets registrations,
metadata, webhooks, API keys, events, runtime config changes, and pause state.
That is acceptable for local development and early gateway work, but production
durability requires a storage adapter or database boundary.

## Request lifecycle

The middleware and route order is load-bearing. Express runs middleware in the
order it is registered, and several handlers depend on earlier layers having
already attached request metadata or enforced short-circuits.

```mermaid
flowchart TD
  A["Incoming HTTP request"] --> B["CORS middleware"]
  B --> C["X-Request-Id correlation middleware"]
  C --> D["JSON body parser (100 KiB limit)"]
  D -->|parser error / body too large| Z["Final error handler: 413 or 500 envelope"]
  D --> E["Pause guard"]
  E -->|paused mutating request| E503["503 service_paused via sendError"]
  E --> F["Per-IP rate limiter"]
  F -->|window exceeded| F429["429 rate_limited + Retry-After"]
  F --> G["Request timing logger"]
  G --> H["Security response headers"]
  H --> I["Mounted route handlers"]
  I -->|explicit validation failure| J["sendError 400/404/etc."]
  I -->|no matching route| K["Structured 404 fallback"]
  I -->|throw or next(err)| Z
  J --> L["Response"]
  K --> L
  E503 --> L
  F429 --> L
  Z --> L
  I -->|success| L
```

The current execution order is:

1. **CORS middleware.** Registered with `cors()`, so CORS headers are applied
   before application-specific request handling.
2. **Request-id correlation.** Reads `X-Request-Id` when present and short
   enough, otherwise generates a UUID. The value is attached to the request and
   echoed as the response `X-Request-Id` header.
3. **JSON parser.** Parses JSON request bodies with a `100kb` size limit.
4. **Pause guard.** Rejects non-idempotent methods with
   `503 service_paused` while still allowing `GET`, `HEAD`, `OPTIONS`, and
   `/api/v1/admin/unpause`.
5. **Rate limiter.** Tracks request timestamps by `req.ip` with a socket
   fallback and returns `429 rate_limited` plus `Retry-After` when the window is
   exceeded. It is skipped when `NODE_ENV === "test"`.
6. **Request timing.** Measures duration, emits one structured log when the
   response finishes, and uses the request id from the correlation middleware.
7. **Security headers.** Adds `X-Content-Type-Options`, `X-Frame-Options`,
   `Referrer-Policy`, and `Strict-Transport-Security`.
8. **Routes.** Health, OpenAPI, admin, config, metrics, stats, API-key,
   webhook, pair, event, and quote endpoints run after the common middleware.
9. **404 fallback.** Unknown routes return the shared structured error shape.
10. **Final error handler.** Parser and thrown errors land here. Body size
    failures become `413 payload_too_large`; other unexpected errors become
    `500 internal_error`.

## Why middleware ordering matters

- **Request id before body parsing.** The inline comment in `src/index.ts`
  calls this out: parser errors still need the canonical error body and a
  correlation id. Moving the JSON parser earlier would make malformed-body
  errors harder to trace.
- **Pause before rate limit.** When the service is paused, mutating requests
  should fail fast with `service_paused` instead of consuming rate-limit slots
  first. The carve-out for `/api/v1/admin/unpause` must stay before the route so
  an operator can recover.
- **Rate limit before route handlers.** Route handlers should not spend CPU or
  mutate in-memory state after the client has exceeded the request window.
- **Timing before security headers and routes.** The timing middleware attaches
  a `finish` listener before downstream handlers send a response, so successes,
  explicit errors, 404s, and final-handler errors are all logged consistently.
- **Security headers before routes.** Headers are set before handlers respond,
  so normal responses and explicit route errors inherit the same baseline
  protections.
- **404 before final error handler.** Unknown routes are not exceptions; they
  are explicit `404 not_found` responses. The final four-argument middleware is
  reserved for parser failures and thrown or forwarded errors.

## Canonical error envelope

Most explicit failures call `sendError`, which produces the shared response
shape:

```json
{
  "error": "invalid_request",
  "message": "human-readable summary",
  "requestId": "correlation-id"
}
```

Handlers can add extra fields when useful, but clients should be able to branch
on `error` consistently. The final error handler preserves the same envelope for
`413 payload_too_large` and `500 internal_error` responses, adding `method` and
`path` for unexpected server errors.

## Where to add new middleware

Use the existing ordering as the default:

- add correlation or parsing prerequisites before route handlers, but keep
  request-id assignment before any middleware that can fail;
- add authentication/authorization after request-id and JSON parsing, and before
  mutating route handlers;
- add operator-wide short-circuits before expensive per-route work;
- keep final catch-all 404 and error middleware last.

When changing the order, update this document and add or adjust tests that prove
the affected error shape, status code, and `requestId` behavior.
