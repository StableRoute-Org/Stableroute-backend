# Security policy

## Contents

- [Supported versions](#supported-versions)
- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Coordinated disclosure](#coordinated-disclosure)
- [Threat model](#threat-model)
- [Non-sensitive security questions](#non-sensitive-security-questions)

## Supported versions

StableRoute is pre-release software. Until versioned releases are published,
security support applies to the `main` branch and the latest deployed commit.

| Version or branch | Supported |
|-------------------|-----------|
| `main` / latest deployed commit | Yes |
| Older commits, forks, or experimental branches | No |

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow instead:

<https://github.com/StableRoute-Org/Stableroute-backend/security/advisories/new>

Include enough detail for maintainers to reproduce and triage the report:

- affected endpoint, route, or middleware;
- impact and attacker capability;
- minimal reproduction steps or proof-of-concept notes;
- whether credentials, tokens, or user data may be exposed;
- any logs or screenshots that do not contain secrets.

If GitHub private reporting is unavailable, ask the maintainers on Discord for a
private reporting contact, but do not post exploit details, secrets, or live
targets in Discord.

## Coordinated disclosure

The maintainers aim to acknowledge private reports within 3 business days and
provide an initial triage update within 10 business days. Fix timelines depend
on severity, exploitability, and release coordination.

Please give maintainers a reasonable opportunity to investigate and release a
fix before publicly disclosing details. The project will credit reporters when
they want credit and when disclosure is safe.

## Threat model

StableRoute backend is a payments-adjacent Express gateway for routing, quote,
pair, webhook, API-key, config, metrics, and health endpoints. The current
implementation is intentionally small and in-memory, so the main security goal
is to keep the documented trust boundaries clear while the production control
plane is still evolving.

### Assets to protect

- routing and quote correctness;
- API keys created through `/api/v1/api-keys`;
- webhook destinations and event payloads;
- operator controls such as pause/unpause and runtime config;
- request identifiers, logs, and error responses;
- in-memory pair, metadata, event, webhook, API-key, and pause state.

### Trust boundaries

1. **Public HTTP boundary.** All Express routes are reachable by clients unless
   an upstream deployment layer restricts them.
2. **Operator/admin boundary.** Admin, config, and write routes are currently in
   the same public app surface as read-only routes.
3. **Reverse proxy boundary.** The rate limiter keys requests by `req.ip` with a
   socket fallback in `src/index.ts`. Deployments that place the app behind a
   load balancer or reverse proxy must ensure only trusted proxy headers can
   influence the client IP.
4. **External URL boundary.** Webhook URLs are accepted from request bodies and
   stored for later use. Any future delivery worker must treat those URLs as
   untrusted network destinations.
5. **Process memory boundary.** Pair registry, pair metadata, webhooks, API
   keys, events, runtime config, and pause state are in-memory data structures
   and reset on process restart.

### Current known-risk surfaces

- **Unauthenticated operator and write routes.** `POST /api/v1/admin/pause`,
  `POST /api/v1/admin/unpause`, `PATCH /api/v1/config`, pair mutation routes,
  webhook mutation routes, and API-key mutation routes are implemented in
  `src/index.ts` without an authentication or authorization guard. Until an auth
  layer lands, deployments should protect these routes at the gateway, network,
  or reverse-proxy layer.
- **Wildcard CORS.** The app calls `cors()` without a restrictive origin policy
  in `src/index.ts`. Browser-accessible deployments should configure allowed
  origins explicitly before exposing authenticated or operator routes.
- **Webhook SSRF potential.** `POST /api/v1/webhooks` accepts `http://` and
  `https://` URLs and stores them. The current code stores webhook definitions;
  any sender added later must block loopback, private, link-local, metadata, and
  otherwise disallowed destinations before making outbound requests.
- **In-memory non-durable state.** The `Map` and `Set` stores in `src/index.ts`
  are useful for local development, but restarts clear pair registrations,
  metadata, webhooks, API keys, events, runtime config, and pause state.
  Production deployments should use durable storage before relying on this state
  for controls or auditability.
- **Rate-limiter proxy trust.** The rate limiter currently depends on Express
  `req.ip`. Deployments behind proxies should treat proxy trust as a security
  setting: do not let arbitrary `X-Forwarded-For` values choose the client key,
  and configure trusted hops or subnets only when the proxy layer is known.

## Non-sensitive security questions

For non-sensitive hardening questions, review coordination, or bounty/campaign
discussion, use the StableRoute Discord:

<https://discord.gg/37aCpusvx>

Do not post vulnerability details, working exploits, secrets, private keys,
tokens, or production target information in public channels.
