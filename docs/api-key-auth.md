# API key authentication

Write routes (`POST /api/v1/pairs`, webhook registration, admin pause controls)
require a valid API key in the `Authorization: Bearer <key>` header.

Keys are stored in the in-memory `apiKeyStore` with scoped permissions
(`pairs:write`, `webhooks:write`, `keys:admin`). See `src/__tests__/apiKeys.test.ts`
for lifecycle coverage.

Never log raw key material — audit events record key ids only.
