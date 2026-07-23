# CI pipeline

GitHub Actions workflow `.github/workflows/ci.yml` runs on every push/PR to `main`:

1. **validate-openapi** — `swagger-cli validate openapi.yaml`
2. **build-test** — `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run test:coverage`

Coverage thresholds are enforced in `jest.config.js`:
- **Statements:** 92 % (global), **Branches:** 86 %, **Functions:** 95 %, **Lines:** 92 %
- Impacted module `server.ts` exceeds 95 % coverage on all metrics except functions (the `require.main === module` guard is not exercised in tests).

Upload the `coverage/` artifact from CI when debugging threshold failures locally:

```bash
npm run test:coverage
```
