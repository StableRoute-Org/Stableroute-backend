---
type: Feature
title: "Add idempotency-key support to the routes write endpoints"
labels: type:feature, area:routes, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent routes

### Description
Retried routes writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on routes writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/routes-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(routes): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the routes list endpoint"
labels: type:feature, area:routes, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate routes

### Description
routes list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the routes list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/routes-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(routes): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for routes"
labels: type:test, area:routes, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test routes

### Description
routes lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering routes success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/routes-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(routes): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound routes request inputs"
labels: type:refactor, area:routes, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate routes

### Description
routes inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate routes request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/routes-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(routes): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the routes API contract and errors"
labels: type:docs, area:routes, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document routes

### Description
routes's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/routes-api.md` describing the routes endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/routes-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(routes): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the quotes write endpoints"
labels: type:feature, area:quotes, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent quotes

### Description
Retried quotes writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on quotes writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/quotes-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(quotes): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the quotes list endpoint"
labels: type:feature, area:quotes, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate quotes

### Description
quotes list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the quotes list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/quotes-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(quotes): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for quotes"
labels: type:test, area:quotes, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test quotes

### Description
quotes lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering quotes success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/quotes-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(quotes): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound quotes request inputs"
labels: type:refactor, area:quotes, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate quotes

### Description
quotes inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate quotes request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/quotes-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(quotes): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the quotes API contract and errors"
labels: type:docs, area:quotes, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document quotes

### Description
quotes's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/quotes-api.md` describing the quotes endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/quotes-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(quotes): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the swaps write endpoints"
labels: type:feature, area:swaps, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent swaps

### Description
Retried swaps writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on swaps writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/swaps-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(swaps): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the swaps list endpoint"
labels: type:feature, area:swaps, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate swaps

### Description
swaps list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the swaps list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/swaps-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(swaps): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for swaps"
labels: type:test, area:swaps, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test swaps

### Description
swaps lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering swaps success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/swaps-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(swaps): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound swaps request inputs"
labels: type:refactor, area:swaps, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate swaps

### Description
swaps inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate swaps request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/swaps-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(swaps): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the swaps API contract and errors"
labels: type:docs, area:swaps, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document swaps

### Description
swaps's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/swaps-api.md` describing the swaps endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/swaps-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(swaps): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the pools write endpoints"
labels: type:feature, area:pools, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent pools

### Description
Retried pools writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on pools writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/pools-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(pools): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the pools list endpoint"
labels: type:feature, area:pools, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate pools

### Description
pools list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the pools list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/pools-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(pools): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for pools"
labels: type:test, area:pools, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test pools

### Description
pools lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering pools success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/pools-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(pools): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound pools request inputs"
labels: type:refactor, area:pools, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate pools

### Description
pools inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate pools request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/pools-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(pools): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the pools API contract and errors"
labels: type:docs, area:pools, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document pools

### Description
pools's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/pools-api.md` describing the pools endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/pools-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(pools): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the liquidity write endpoints"
labels: type:feature, area:liquidity, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent liquidity

### Description
Retried liquidity writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on liquidity writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/liquidity-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(liquidity): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the liquidity list endpoint"
labels: type:feature, area:liquidity, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate liquidity

### Description
liquidity list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the liquidity list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/liquidity-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(liquidity): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for liquidity"
labels: type:test, area:liquidity, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test liquidity

### Description
liquidity lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering liquidity success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/liquidity-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(liquidity): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound liquidity request inputs"
labels: type:refactor, area:liquidity, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate liquidity

### Description
liquidity inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate liquidity request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/liquidity-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(liquidity): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the liquidity API contract and errors"
labels: type:docs, area:liquidity, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document liquidity

### Description
liquidity's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/liquidity-api.md` describing the liquidity endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/liquidity-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(liquidity): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the tokens write endpoints"
labels: type:feature, area:tokens, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent tokens

### Description
Retried tokens writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on tokens writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/tokens-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(tokens): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the tokens list endpoint"
labels: type:feature, area:tokens, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate tokens

### Description
tokens list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the tokens list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/tokens-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(tokens): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for tokens"
labels: type:test, area:tokens, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test tokens

### Description
tokens lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering tokens success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/tokens-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(tokens): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound tokens request inputs"
labels: type:refactor, area:tokens, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate tokens

### Description
tokens inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate tokens request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/tokens-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(tokens): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the tokens API contract and errors"
labels: type:docs, area:tokens, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document tokens

### Description
tokens's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/tokens-api.md` describing the tokens endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/tokens-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(tokens): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the prices write endpoints"
labels: type:feature, area:prices, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent prices

### Description
Retried prices writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on prices writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/prices-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(prices): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the prices list endpoint"
labels: type:feature, area:prices, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate prices

### Description
prices list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the prices list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/prices-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(prices): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for prices"
labels: type:test, area:prices, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test prices

### Description
prices lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering prices success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/prices-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(prices): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound prices request inputs"
labels: type:refactor, area:prices, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate prices

### Description
prices inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate prices request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/prices-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(prices): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the prices API contract and errors"
labels: type:docs, area:prices, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document prices

### Description
prices's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/prices-api.md` describing the prices endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/prices-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(prices): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the fees write endpoints"
labels: type:feature, area:fees, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent fees

### Description
Retried fees writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on fees writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/fees-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(fees): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the fees list endpoint"
labels: type:feature, area:fees, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate fees

### Description
fees list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the fees list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/fees-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(fees): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for fees"
labels: type:test, area:fees, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test fees

### Description
fees lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering fees success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/fees-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(fees): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound fees request inputs"
labels: type:refactor, area:fees, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate fees

### Description
fees inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate fees request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/fees-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(fees): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the fees API contract and errors"
labels: type:docs, area:fees, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document fees

### Description
fees's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/fees-api.md` describing the fees endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/fees-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(fees): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the slippage write endpoints"
labels: type:feature, area:slippage, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent slippage

### Description
Retried slippage writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on slippage writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/slippage-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(slippage): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the slippage list endpoint"
labels: type:feature, area:slippage, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate slippage

### Description
slippage list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the slippage list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/slippage-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(slippage): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for slippage"
labels: type:test, area:slippage, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test slippage

### Description
slippage lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering slippage success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/slippage-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(slippage): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound slippage request inputs"
labels: type:refactor, area:slippage, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate slippage

### Description
slippage inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate slippage request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/slippage-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(slippage): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the slippage API contract and errors"
labels: type:docs, area:slippage, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document slippage

### Description
slippage's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/slippage-api.md` describing the slippage endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/slippage-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(slippage): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the health write endpoints"
labels: type:feature, area:health, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent health

### Description
Retried health writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on health writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/health-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(health): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the health list endpoint"
labels: type:feature, area:health, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate health

### Description
health list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the health list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/health-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(health): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for health"
labels: type:test, area:health, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test health

### Description
health lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering health success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/health-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(health): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound health request inputs"
labels: type:refactor, area:health, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate health

### Description
health inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate health request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/health-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(health): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the health API contract and errors"
labels: type:docs, area:health, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document health

### Description
health's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/health-api.md` describing the health endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/health-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(health): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the metrics write endpoints"
labels: type:feature, area:metrics, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent metrics

### Description
Retried metrics writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on metrics writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/metrics-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(metrics): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the metrics list endpoint"
labels: type:feature, area:metrics, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate metrics

### Description
metrics list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the metrics list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/metrics-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(metrics): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for metrics"
labels: type:test, area:metrics, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test metrics

### Description
metrics lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering metrics success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/metrics-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(metrics): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound metrics request inputs"
labels: type:refactor, area:metrics, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate metrics

### Description
metrics inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate metrics request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/metrics-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(metrics): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the metrics API contract and errors"
labels: type:docs, area:metrics, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document metrics

### Description
metrics's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/metrics-api.md` describing the metrics endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/metrics-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(metrics): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the webhooks write endpoints"
labels: type:feature, area:webhooks, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent webhooks

### Description
Retried webhooks writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on webhooks writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/webhooks-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(webhooks): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the webhooks list endpoint"
labels: type:feature, area:webhooks, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate webhooks

### Description
webhooks list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the webhooks list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/webhooks-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(webhooks): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for webhooks"
labels: type:test, area:webhooks, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test webhooks

### Description
webhooks lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering webhooks success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/webhooks-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(webhooks): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound webhooks request inputs"
labels: type:refactor, area:webhooks, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate webhooks

### Description
webhooks inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate webhooks request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/webhooks-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(webhooks): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the webhooks API contract and errors"
labels: type:docs, area:webhooks, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document webhooks

### Description
webhooks's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/webhooks-api.md` describing the webhooks endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/webhooks-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(webhooks): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the events write endpoints"
labels: type:feature, area:events, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent events

### Description
Retried events writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on events writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/events-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(events): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the events list endpoint"
labels: type:feature, area:events, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate events

### Description
events list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the events list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/events-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(events): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for events"
labels: type:test, area:events, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test events

### Description
events lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering events success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/events-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(events): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound events request inputs"
labels: type:refactor, area:events, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate events

### Description
events inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate events request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/events-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(events): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the events API contract and errors"
labels: type:docs, area:events, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document events

### Description
events's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/events-api.md` describing the events endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/events-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(events): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the auth write endpoints"
labels: type:feature, area:auth, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent auth

### Description
Retried auth writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on auth writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/auth-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(auth): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the auth list endpoint"
labels: type:feature, area:auth, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate auth

### Description
auth list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the auth list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/auth-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(auth): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for auth"
labels: type:test, area:auth, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test auth

### Description
auth lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering auth success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/auth-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(auth): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound auth request inputs"
labels: type:refactor, area:auth, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate auth

### Description
auth inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate auth request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/auth-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(auth): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the auth API contract and errors"
labels: type:docs, area:auth, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document auth

### Description
auth's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/auth-api.md` describing the auth endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/auth-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(auth): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the api-keys write endpoints"
labels: type:feature, area:api-keys, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent api-keys

### Description
Retried api-keys writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on api-keys writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/api-keys-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(api-keys): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the api-keys list endpoint"
labels: type:feature, area:api-keys, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate api-keys

### Description
api-keys list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the api-keys list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/api-keys-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(api-keys): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for api-keys"
labels: type:test, area:api-keys, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test api-keys

### Description
api-keys lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering api-keys success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/api-keys-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(api-keys): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound api-keys request inputs"
labels: type:refactor, area:api-keys, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate api-keys

### Description
api-keys inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate api-keys request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/api-keys-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(api-keys): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the api-keys API contract and errors"
labels: type:docs, area:api-keys, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document api-keys

### Description
api-keys's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/api-keys-api.md` describing the api-keys endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/api-keys-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(api-keys): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the transactions write endpoints"
labels: type:feature, area:transactions, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent transactions

### Description
Retried transactions writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on transactions writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/transactions-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(transactions): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the transactions list endpoint"
labels: type:feature, area:transactions, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate transactions

### Description
transactions list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the transactions list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/transactions-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(transactions): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for transactions"
labels: type:test, area:transactions, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test transactions

### Description
transactions lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering transactions success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/transactions-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(transactions): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound transactions request inputs"
labels: type:refactor, area:transactions, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate transactions

### Description
transactions inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate transactions request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/transactions-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(transactions): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the transactions API contract and errors"
labels: type:docs, area:transactions, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document transactions

### Description
transactions's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/transactions-api.md` describing the transactions endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/transactions-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(transactions): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the settlements write endpoints"
labels: type:feature, area:settlements, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent settlements

### Description
Retried settlements writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on settlements writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/settlements-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(settlements): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the settlements list endpoint"
labels: type:feature, area:settlements, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate settlements

### Description
settlements list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the settlements list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/settlements-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(settlements): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for settlements"
labels: type:test, area:settlements, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test settlements

### Description
settlements lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering settlements success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/settlements-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(settlements): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound settlements request inputs"
labels: type:refactor, area:settlements, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate settlements

### Description
settlements inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate settlements request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/settlements-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(settlements): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the settlements API contract and errors"
labels: type:docs, area:settlements, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document settlements

### Description
settlements's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/settlements-api.md` describing the settlements endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/settlements-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(settlements): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the bridges write endpoints"
labels: type:feature, area:bridges, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent bridges

### Description
Retried bridges writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on bridges writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/bridges-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(bridges): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the bridges list endpoint"
labels: type:feature, area:bridges, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate bridges

### Description
bridges list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the bridges list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/bridges-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(bridges): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for bridges"
labels: type:test, area:bridges, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test bridges

### Description
bridges lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering bridges success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/bridges-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(bridges): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound bridges request inputs"
labels: type:refactor, area:bridges, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate bridges

### Description
bridges inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate bridges request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/bridges-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(bridges): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the bridges API contract and errors"
labels: type:docs, area:bridges, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document bridges

### Description
bridges's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/bridges-api.md` describing the bridges endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/bridges-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(bridges): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the config write endpoints"
labels: type:feature, area:config, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent config

### Description
Retried config writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on config writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/config-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(config): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the config list endpoint"
labels: type:feature, area:config, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate config

### Description
config list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the config list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/config-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(config): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for config"
labels: type:test, area:config, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test config

### Description
config lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering config success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/config-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(config): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound config request inputs"
labels: type:refactor, area:config, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate config

### Description
config inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate config request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/config-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(config): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the config API contract and errors"
labels: type:docs, area:config, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document config

### Description
config's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/config-api.md` describing the config endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/config-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(config): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add idempotency-key support to the audit write endpoints"
labels: type:feature, area:audit, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Idempotent audit

### Description
Retried audit writes can double-apply. This issue adds idempotency-key support.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Accept an Idempotency-Key on audit writes and return the stored result on replay within a TTL.
- Reject a reused key with a different body (409).
- Cover first-write, replay, and conflict in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/audit-91-idem`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first write, replay same, replay different body 409.
- Include the full test output in the PR description.

### Example commit message
`feat(audit): add idempotency keys`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add cursor pagination to the audit list endpoint"
labels: type:feature, area:audit, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Paginate audit

### Description
audit list returns everything at once. This issue adds cursor pagination.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add opaque-cursor pagination to the audit list endpoint with a bounded page size.
- Return a stable nextCursor; reject invalid cursors.
- Cover first page, next page, end, and invalid cursor in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b feature/audit-92-cursor`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: first page, next, end, invalid cursor.
- Include the full test output in the PR description.

### Example commit message
`feat(audit): add cursor pagination`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Add success and error-path tests for audit"
labels: type:test, area:audit, stack:nodejs, stack:typescript, priority:high, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Test audit

### Description
audit lacks full success/error coverage. This issue adds it.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add tests covering audit success plus the main error paths (validation, not-found, conflict).
- Deterministic; no real network.
- Note any defect uncovered.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b test/audit-91-paths`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: success, validation, not-found, conflict.
- Include the full test output in the PR description.

### Example commit message
`test(audit): cover success and error paths`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Validate and bound audit request inputs"
labels: type:refactor, area:audit, stack:nodejs, stack:typescript, priority:medium, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Validate audit

### Description
audit inputs aren't fully bounded. This issue adds declarative validation.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Validate audit request inputs against a schema with sane bounds; reject invalid with structured 400s.
- Behaviour otherwise unchanged.
- Cover valid and invalid in tests.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b refactor/audit-91-validate`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: valid passes, oversized/malformed rejected.
- Include the full test output in the PR description.

### Example commit message
`refactor(audit): validate and bound inputs`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
++++++
---
type: Feature
title: "Document the audit API contract and errors"
labels: type:docs, area:audit, stack:nodejs, stack:typescript, priority:low, Stellar Wave, MAYBE REWARDED, GRANTFOX OSS, OFFICIAL CAMPAIGN, Official Campaign | FWC26
assignees: ''
---

## Document audit

### Description
audit's API contract isn't documented. This issue adds a reference.

### Requirements and context
- **Repository scope:** StableRoute-Org/Stableroute-backend only.
- Add `docs/audit-api.md` describing the audit endpoints, params, responses, and error codes.
- Keep accurate to the routes.
- Link from the docs index.

### Suggested execution
- Fork the repo and create a branch
- `git checkout -b docs/audit-91-api`
- Implement changes
  - **Write code in:** the relevant module.
  - **Write comprehensive tests in:** cover the new behaviour and edge cases.
- Test and commit

### Test and commit
- Run `npm run lint`, `npm test`, and `npm run build`.
- Cover edge cases: n/a — verify against routes.
- Include the full test output in the PR description.

### Example commit message
`docs(audit): document API contract`

### Guidelines
- **Minimum 95 percent test coverage** for impacted modules.
- Clear, reviewer-focused documentation.
- **Timeframe: 96 hours.**

### Community & contribution rewards
- 💬 **Join the StableRoute community on Discord:** https://discord.gg/37aCpusvx
- ⭐ This is a **GrantFox OSS / Official Campaign** task and **may be rewarded**. When your PR is merged you'll be prompted to rate the project — a **5-star rating** is much appreciated.
