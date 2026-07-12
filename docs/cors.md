# CORS configuration

StableRoute backend enables CORS via the `cors` package with an environment-driven
allowlist (`CORS_ORIGINS`). Preflight `OPTIONS` requests pass through even when
the service is paused so browser clients can recover gracefully.

See `src/__tests__/cors.test.ts` for regression coverage of preflight headers on
`/api/v1/pairs` and pause-mode behaviour.
