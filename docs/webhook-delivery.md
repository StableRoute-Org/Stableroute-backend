# Webhook delivery worker

Registered webhooks are stored in the in-memory `webhookStore`. Delivery
workers (when enabled) POST signed payloads to subscriber URLs with retries
and exponential backoff.

Security requirements:

- Callback URLs must be public `http(s)` endpoints (`isSafeWebhookUrl`)
- Event subscriptions use the `namespace.action` convention or `*`
- Secrets are never returned from list/get endpoints

See `src/__tests__/webhooks.test.ts` for registration validation and
`docs/validation.md` for SSRF guards on URL registration.
