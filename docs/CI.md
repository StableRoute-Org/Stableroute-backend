# CI pipeline

GitHub Actions workflow `.github/workflows/ci.yml` runs on every push/PR to `main`:

## Jobs

1. **validate-openapi** — `swagger-cli validate openapi.yaml`
2. **dependency-audit** — `node scripts/audit-deps.js` (wraps `npm audit --json` with allowlist filtering)
3. **dependency-review** — `actions/dependency-review-action@v4` flags newly introduced vulnerable packages on PRs
4. **build-test** (depends on validate-openapi + dependency-audit) — `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run test:coverage`

## Coverage thresholds

Coverage thresholds are enforced in `jest.config.js`:
- **Statements:** 92 % (global), **Branches:** 86 %, **Functions:** 95 %, **Lines:** 92 %
- Impacted module `server.ts` exceeds 95 % coverage on all metrics except functions (the `require.main === module` guard is not exercised in tests).

Upload the `coverage/` artifact from CI when debugging threshold failures locally:

```bash
npm run test:coverage
```

## Dependency audit

The `dependency-audit` job runs `scripts/audit-deps.js` which:

1. Calls `npm audit --json` to enumerate known vulnerabilities
2. Reads `.audit-allowlist.json` to exclude advisories with no available fix
3. Fails the build if any high or critical vulnerabilities remain after filtering

### Allowlist

When a vulnerability has no available fix, add it to `.audit-allowlist.json` at the project root:

```json
[
  {
    "id": "GHSA-xxxx-xxxx-xxxx",
    "reason": "No fix available yet — tracked in issue #NNN",
    "expires": "2026-10-01"
  }
]
```

**Fields:**
- `id` — Advisory identifier (GHSA ID or numeric npm advisory ID)
- `reason` — Brief justification and link to tracking issue
- `expires` — ISO date after which the entry is ignored (time-boxed)

**Policy:**
- Every allowlist entry must have an expiration date (time-boxed)
- Expired entries are automatically ignored by the audit script
- Entries should be removed once a fix is released and the dependency is updated

### Local audit

Run the same check locally before pushing:

```bash
node scripts/audit-deps.js
```

Requires `npm ci` to have been run first so that `node_modules` and `package-lock.json` are present.

## Dependency review

The `dependency-review` job runs only on pull requests. It uses `actions/dependency-review-action@v4` to compare the dependency changes in the PR against the base branch and fails if newly introduced packages have known high-severity vulnerabilities.
