Document document the Idempotency-Key contract and cache semantics
Description
The idempotencyGuard in src/index.ts protects pair, webhook, and api-key creation with a TTL cache, a 409 conflict path, and a 200-character key bound, none of which is documented for API consumers.

Requirements and context
Repository scope: StableRoute-Org/Stableroute-backend only.
Specify the header name, accepted key length, TTL, and replay-response semantics.
Describe exactly when a 409 idempotency_conflict is returned versus a cached replay.
List which endpoints participate and note explicitly that other mutating routes do not.
Suggested execution
Fork the repo and create a branch
git checkout -b docs/docs-document-the-idempotency-key-contract
Write code in: docs/idempotency.md
Write comprehensive tests in: src/__tests__/idempotencyCache.test.ts
Add documentation: docs/idempotency.md
Test and commit
Run npm test, npm run lint
Cover edge cases; include test output
Example commit message
docs: document the Idempotency-Key contract and cache semantics

Guidelines
Minimum 95 percent test coverage for impacted modules
Clear documentation
