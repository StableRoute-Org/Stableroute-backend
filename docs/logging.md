# Structured logging

StableRoute backend uses request-scoped correlation via `X-Request-Id` (see
`docs/middleware-order.md`). Each handler calls `sendError` / `recordEvent` with
the active request id so operators can trace a single client call through audit
events and Prometheus gauges.

Recommended log fields when extending handlers:

- `requestId` — propagated from middleware
- `route` — Express path template
- `status` — HTTP status emitted
- `eventType` — audit log category when applicable

Pair and webhook mutations emit structured audit events (`pair.registered`,
`webhook.created`, etc.) rather than ad-hoc `console.log` output.
