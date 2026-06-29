# Security Policy

## Table of Contents

1. [Supported Versions](#supported-versions)
2. [Reporting a Vulnerability](#reporting-a-vulnerability)
3. [Coordinated Disclosure](#coordinated-disclosure)
4. [Threat Model](#threat-model)
   - [Trust Boundaries](#trust-boundaries)
   - [Known Risk Surfaces](#known-risk-surfaces)
5. [Out of Scope](#out-of-scope)

---

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` (latest) | Yes |
| All others | No — update to `main` before reporting |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Send a private report to the maintainers via one of these channels:

- **Email:** security@stableroute.dev _(monitored by core maintainers)_
- **GitHub private advisory:** use the "Report a vulnerability" button on the
  [Security tab](../../security/advisories/new) of this repository.

Include in your report:

- A clear description of the vulnerability and the affected component.
- Steps to reproduce or a minimal proof-of-concept (describe the _class_ of
  risk; do not include working exploit payloads or live credentials).
- The potential impact you have assessed.
- Any suggested mitigations.

**Expected response window:**

| Stage | Target |
| ----- | ------ |
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Patch / coordinated disclosure | 90 days (may be shortened for critical issues) |

For non-sensitive questions (API behaviour, general hardening questions, threat
model discussions) use the
[StableRoute Discord](https://discord.gg/37aCpusvx) `#security` channel.

---

## Coordinated Disclosure

We follow a **coordinated disclosure** model:

1. Reporter privately notifies the maintainers.
2. Maintainers confirm and assess the issue.
3. A fix is prepared in a private branch and reviewed.
4. A release is cut and the advisory is published simultaneously, crediting the
   reporter unless they prefer to remain anonymous.
5. A CVE is requested where appropriate.

We will not take legal action against researchers who follow this policy.

---

## Threat Model

StableRoute-backend is a **payments-adjacent routing and pricing gateway** that
sits between external callers and the Stellar on-chain routing contract. The
process is stateless between restarts; all runtime state lives in process
memory (`src/stores.ts`).

### Trust Boundaries

```
External callers (internet)
        │  HTTP
        ▼
┌───────────────────────────┐
│  Express gateway          │  ← src/index.ts
│  (rate limiter, CORS,     │
│   body-parser, logging)   │
└───────┬───────────────────┘
        │ in-process function calls
        ▼
┌───────────────────────────┐
│  In-memory stores         │  ← src/stores.ts
│  (pairs, keys, webhooks,  │
│   events, config, state)  │
└───────────────────────────┘
        │ (future) outbound HTTP
        ▼
  Stellar Horizon / RPC
  Registered webhook targets
```

All requests cross a single trust boundary: the public internet to the Express
process. There is currently **no authentication layer** between these
boundaries; see the risk surfaces below.

### Known Risk Surfaces

#### 1. Unauthenticated Admin and Write Routes

**Location:** `src/index.ts` — `POST /api/v1/admin/pause`,
`POST /api/v1/admin/unpause`, `GET /api/v1/admin/status`,
`PATCH /api/v1/config`, `POST /api/v1/pairs`, `POST /api/v1/api-keys`,
`POST /api/v1/webhooks`.

**Risk:** Any network-reachable caller can pause the service, alter rate-limit
configuration, register arbitrary trading pairs, create API keys, or register
webhook URLs. In a production deployment this is a denial-of-service and data-
integrity risk.

**Planned mitigation:** A gateway authentication guard (bearer token or mTLS)
before all `/admin/*` and write routes is tracked as a follow-up issue.

---

#### 2. Wildcard CORS

**Location:** `src/index.ts` — `app.use(cors())` (no origin restriction).

**Risk:** Any browser origin can make credentialed requests to the API. If
cookie or ambient-authority authentication is added later, this becomes a
cross-site request forgery (CSRF) vector.

**Planned mitigation:** Restrict `origin` to the known frontend domain(s) via
the `cors({ origin: [...] })` option before adding cookie-based auth.

---

#### 3. Webhook SSRF Potential

**Location:** `src/index.ts` — `POST /api/v1/webhooks`.

**Risk:** The webhook URL is validated only for `http://` or `https://` scheme
and a 2 048-character length cap. An attacker can register a URL pointing to
internal services (e.g. `http://169.254.169.254/` on cloud hosts,
`http://localhost:9200/` for an internal Elasticsearch node) that will be
fetched by the future delivery worker, performing a Server-Side Request Forgery
(SSRF) attack.

**Planned mitigation:** Resolve and block RFC 1918 / loopback / link-local
addresses before delivery; optionally maintain an allowlist of permitted
webhook domains.

---

#### 4. In-Memory Non-Durable State

**Location:** `src/stores.ts` — all stores (`pairRegistry`, `apiKeyStore`,
`webhookStore`, `eventLog`, `rateBuckets`, `config`, `paused`).

**Risk:** Process restart, crash, or OOM kill wipes all registered pairs, API
keys, webhooks, and configuration. In a multi-replica deployment, each replica
holds independent state, making consistent reads impossible.

**Planned mitigation:** A persistent storage adapter (database) is planned;
the store module's accessor interface is designed to accommodate this swap.

---

#### 5. Rate-Limiter Proxy Trust

**Location:** `src/index.ts` — rate limiter using `req.ip`.

**Risk:** Express resolves `req.ip` from the left-most `X-Forwarded-For` entry
only when `app.set("trust proxy", n)` is configured. Without that setting the
socket address (typically the load balancer IP) is used, collapsing all clients
into a single bucket and making the rate limiter ineffective.

**Planned mitigation:** Set `app.set("trust proxy", 1)` (or the appropriate
hop count) when deploying behind a reverse proxy; document the expected network
topology.

---

## Out of Scope

- Vulnerabilities in dependencies that have already been publicly disclosed and
  have an upstream fix available — please update dependencies and verify before
  reporting.
- Denial-of-service attacks that require sustained traffic beyond the rate limit
  (infrastructure-level DDoS).
- Social engineering of maintainers.
- Findings from automated scanners submitted without a manual assessment of
  applicability.
