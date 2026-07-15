# Security headers

Baseline hardening headers are applied on every response (see
`src/__tests__/securityHeaders.test.ts`):

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=…` |

Content-Security-Policy tightening is tracked separately; do not duplicate header
logic outside the centralized middleware.
