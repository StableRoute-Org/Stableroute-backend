Add add a dependency audit and review job to the CI workflow
Description
.github/workflows/ci.yml validates OpenAPI, lints, builds, tests, and uploads coverage, but never checks the dependency tree for known vulnerabilities or license drift.

Requirements and context
Repository scope: StableRoute-Org/Stableroute-backend only.
Add an npm audit --audit-level=high step that fails the build on high or critical findings.
Add actions/dependency-review-action on pull requests to flag newly introduced vulnerable packages.
Allow a documented, time-boxed allowlist for advisories with no available fix.
Suggested execution
Fork the repo and create a branch
git checkout -b security/ci-add-a-dependency-audit-and
Write code in: .github/workflows/ci.yml
Write comprehensive tests in: src/__tests__/ciWorkflow.test.ts
Add documentation: docs/CI.md
Test and commit
Run npm test, npm run lint
Cover edge cases; include test output
Example commit message
ci(security): add npm audit and dependency review jobs

Guidelines
Minimum 95 percent test coverage for impacted modules
Clear documentation
