# CI pipeline

GitHub Actions runs two workflows on every push/PR to `main`:

## 1. Build & Test (`.github/workflows/ci.yml`)

1. **validate-openapi** — `swagger-cli validate openapi.yaml`
2. **build-test** — `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run test:coverage`

Coverage thresholds are enforced in `jest.config.js`:
- **Statements:** 92 % (global), **Branches:** 86 %, **Functions:** 95 %, **Lines:** 92 %
- Impacted module `server.ts` exceeds 95 % coverage on all metrics except functions (the `require.main === module` guard is not exercised in tests).

Upload the `coverage/` artifact from CI when debugging threshold failures locally:

```bash
npm run test:coverage
```

---

## 2. CodeQL Static Analysis (`.github/workflows/codeql.yml`)

CodeQL performs inter-procedural data-flow and taint analysis on the TypeScript sources to catch injection, XSS, unsafe deserialization, and hardcoded-secret bugs before they reach production.

### Trigger conditions

| Event           | When it runs                                   | Path filter                              |
| --------------- | ---------------------------------------------- | ---------------------------------------- |
| `push`          | Commits to `main`                              | `src/**`, `.github/workflows/codeql.yml`, `.github/codeql/**` |
| `pull_request`  | PRs targeting `main`                           | same as push                             |
| `schedule`      | Weekly, Monday 04:37 UTC (off-peak)            | full repo scan                          |

### Analyzed scope

Defined in `.github/codeql/codeql-config.yml`:

- **Include:** `src/` (all production TypeScript, including the 2251-line `src/index.ts` routing engine)
- **Exclude:** `src/**/__tests__/**`, `**/node_modules/**`, `**/dist/**`, `**/coverage/**`

### Query packs

The workflow runs `queries: security-and-quality` against the `codeql/javascript-typescript` pack:

- `codeql/javascript-queries` — default security queries (SQL/NoSQL injection, command injection, path traversal, prototype pollution, hardcoded secrets, etc.)
- `codeql/javascript-experimental` — newer taint- and data-flow queries that may surface additional true positives in Express/Pino/Helmet-heavy codebases.

### Job permissions

The `analyze` job requests the minimum permissions required:

| Permission          | Level   | Why it is needed                                       |
| ------------------- | ------- | ------------------------------------------------------ |
| `security-events`   | `write` | Upload SARIF results to the GitHub Security tab        |
| `actions`           | `read`  | Read action artifacts across job dependencies          |
| `contents`          | `read`  | Clone repository sources for analysis                  |

### Artifacts

- **`codeql-sarif-javascript-typescript`** — the raw SARIF JSON, retained for 30 days. Download this artifact to reproduce findings locally with the CodeQL CLI.

---

## Triage workflow — CodeQL findings

When a CodeQL job reports `new alert(s) found`, follow this process.

### 1. Open the Security tab

1. Go to the repository home page.
2. Click **Security** → **Code scanning**.
3. Filter by **Tool = CodeQL** and **Branch = <your PR branch>**.

Each alert card shows:
- The rule id (e.g. `js/sql-injection`) and CWE (e.g. CWE-89).
- A data-flow path graph with source → step(s) → sink.
- The exact commit that introduced the alert (for `push`-triggered runs).

### 2. Classify the finding

| Outcome            | How to decide                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **True positive**  | The sink is reachable with attacker-controlled data, and the code does not validate/encode adequately before use.    |
| **False positive** | The data path is impossible (impossible enum branches, sanitizer present but not modelled, constant only, etc.).     |
| **Won't fix**      | Finding is in dead code, behind an admin-only boundary, or the risk is accepted per the SECURITY.md threat model.    |

### 3. Fix or dismiss

#### Fix a true positive

1. Add an input-validation layer (Zod schema, Joi, or the project's existing `parseAmountAssetCode`-style pure validators — see `src/utils/*`).
2. Parameterize queries / escape output at the sink layer following the rule remediation hint.
3. Add a unit test under `src/__tests__/` covering both the benign and malicious payloads. Coverage threshold is 95 % for impacted modules.
4. Re-run the **CodeQL** workflow from the **Actions** tab. The alert status moves to **Fixed** when the scan no longer reaches the sink.

#### Dismiss a false positive / won't fix

Dismissal is performed inside the alert card in the UI. Choose a **Reason**:

| Reason                       | When to use                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **False positive**           | CodeQL missed a sanitizer or structural impossibility.                                                       |
| **Used in tests**            | Alert is inside `src/**/__tests__/**` and somehow leaked through path filters.                                |
| **Not applicable**           | The vulnerable API surface is not exposed to untrusted actors in this deployment model.                       |
| **Risk accepted**            | The maintainers acknowledge the risk and recorded an exception in `SECURITY.md`.                              |

**Required:** always fill the **Comment** field with a one-line justification linking to the specific sanitizer / code path. Example:

> Tainted value passes through `parseAmountAssetCode()` strict regex validator at src/utils/clientIp.ts#L42 before reaching the sink.

### 4. Suppression patterns (prefer dismissal in UI first)

If a finding recurs frequently across multiple locations *and* the CodeQL model cannot be improved with a `codeql-pack-filter`, add a **comment-based suppression** directly above the offending line, following the style:

```ts
// lgtm[js/unused-local-variable]
// codeql[js/prototype-pollution] false positive: proto guarded by Object.hasOwn
const result = map[key];
```

**Rule of thumb:** prefer UI dismissal. Code comment suppression is only for patterns that the security team has explicitly blessed after review.

### 5. Tracking open findings

- Open alerts appear in the **Security** tab with **Open** status.
- A weekly digest is sent to repository watchers following the Monday scheduled scan.
- Any alert open longer than 30 days without a dismissal comment triggers a maintainer ping — re-triage it to decide between fix / accept / escalate.

---

## Running CodeQL locally (optional, for rapid iteration)

Install the [CodeQL CLI](https://docs.github.com/en/code-security/codeql-cli/getting-started-with-the-codeql-cli/setting-up-the-codeql-cli) and reproduce the exact CI queries:

```bash
# 1. Create a database from the compiled TS sources
codeql database create codeql-db \
  --language=javascript-typescript \
  --source-root=. \
  --command="npm run build"

# 2. Run the same query suite CI uses
codeql database analyze codeql-db \
  codeql/javascript-typescript:codeql/javascript-queries \
  codeql/javascript-typescript:codeql/javascript-experimental \
  --format=sarif-latest \
  --output=codeql-local.sarif \
  --threads=0

# 3. Upload / inspect results
codeql github upload-results \
  --sarif=codeql-local.sarif \
  --repository=StableRoute-Org/Stableroute-backend \
  --ref=refs/heads/$(git branch --show-current) \
  --commit=$(git rev-parse HEAD)
```

---

## Common JavaScript/TypeScript rules seen in this repo

| Rule id                                 | CWE     | Typical trigger                                            |
| --------------------------------------- | ------- | ---------------------------------------------------------- |
| `js/sql-injection`                      | CWE-89  | Untrusted input interpolated into SQL / CQL strings.       |
| `js/path-injection`                     | CWE-22  | `fs.*` call with user-controlled `path.join()` segment.    |
| `js/command-injection`                  | CWE-78  | `exec` / `spawn` with untrusted arguments.                 |
| `js/nosql-injection`                    | CWE-943 | Untrusted keys passed directly to store query objects.     |
| `js/hardcoded-credentials`              | CWE-798 | Literal secrets or tokens in source (not `.env`).          |
| `js/xss`                                | CWE-79  | Raw string interpolation into HTML/JSONP responses.        |
| `js/prototype-pollution`                | CWE-1321| Unsafe recursive merge / spread of user-controlled keys.   |
| `js/unsafe-deserialization`             | CWE-502 | Calling `JSON.parse` on data from a non-authoritative source. |
| `js/clear-text-logging-of-sensitive-data`| CWE-532 | Logging full request body or authorization header values.  |
| `js/missing-rate-limiting`              | CWE-770 | New public Express route without `rateLimit` middleware.   |

When a new rule fires for the first time, add a row to this table with the remediation pattern that the codebase adopts for it.
