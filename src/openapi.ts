/**
 * Single source of truth for the StableRoute Backend OpenAPI 3.0.3 document.
 *
 * This module exports `openApiSpec`, the canonical OpenAPI specification that
 * describes every public `/api/v1/` route served by this backend. The
 * `GET /api/v1/openapi.json` handler in `src/index.ts` serves it verbatim
 * without transformation so the spec and handler can never diverge.
 *
 * **Route-drift guard:** `src/__tests__/openapi.test.ts` walks the Express
 * router stack at test time, converts each registered route to its OpenAPI
 * templated form (`:param` → `{param}`), and asserts that every discovered
 * path appears as a key in this spec's `paths`. This makes it impossible to
 * ship a new endpoint without documenting it — the test must fail.
 *
 * Each operation includes:
 * - A `summary` (one-line, human-readable description).
 * - A `responses` map with the status codes the endpoint is known to return
 *   and a brief description of each.
 *
 * **Security note:** This spec must never reference internal-only routes,
 * secrets, or implementation details (e.g. `/admin/pause` paths are included
 * as operator-facing, but internal middleware paths like the Express error
 * handler are deliberately absent).
 *
 * @module openapi
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "StableRoute Backend",
    version: "1.0.0",
    description:
      "API gateway, routing engine, and pricing service for StableRoute — Stellar liquidity routing.",
  },

  paths: {
    // -------------------------------------------------------------------
    // Health
    // -------------------------------------------------------------------
    "/health": {
      get: {
        summary: "Shallow liveness probe",
        description:
          "Returns a lightweight health check suitable for load-balancer polls. No dependencies are exercised.",
        responses: {
          "200": { description: "Service is alive" },
        },
      },
    },

    "/api/v1/health/deep": {
      get: {
        summary: "Deep readiness probe",
        description:
          "Kubernetes-style readiness probe that exercises storage and clock checks. Returns `status: \"ok\"` when healthy, `\"degraded\"` with HTTP 503 when a check fails, or `\"paused\"` when the admin pause is engaged.",
        responses: {
          "200": { description: "All checks passed (or service is paused)" },
          "503": { description: "One or more health checks failed" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Observability
    // -------------------------------------------------------------------
    "/api/v1/metrics": {
      get: {
        summary: "Prometheus metrics",
        description:
          "Exposes application-level metrics in Prometheus exposition format (`text/plain`). This endpoint is exempt from JSON content negotiation.",
        responses: {
          "200": { description: "Prometheus-format metrics payload" },
        },
      },
    },

    "/api/v1/stats": {
      get: {
        summary: "Aggregate snapshot",
        description:
          "Returns a point-in-time summary of registered pairs, API keys, webhooks, event-log size, and rate-limit configuration.",
        responses: {
          "200": { description: "Aggregate statistics object" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------
    "/api/v1/events": {
      get: {
        summary: "Audit log",
        description:
          "Paginated, filterable list of application audit events. Supports `since` (epoch-ms), `limit`, `type`, and cursor-based pagination.",
        parameters: [
          { name: "since", in: "query", schema: { type: "integer" }, description: "Return events with timestamp ≥ this epoch-ms value (default 0)" },
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Maximum items per page (default 100, clamped to eventLogCap)" },
          { name: "type", in: "query", schema: { type: "string" }, description: "Filter by event type (e.g. `pair.registered`)" },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque base64-encoded pagination cursor" },
        ],
        responses: {
          "200": { description: "Paginated event list with nextCursor" },
          "400": { description: "Invalid `since`, `limit`, `type`, or `cursor`" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------
    "/api/v1/config": {
      get: {
        summary: "Read runtime configuration",
        description:
          "Returns the current in-memory configuration values (rate limits, bulk caps, event-log cap, quote TTL).",
        responses: {
          "200": { description: "Configuration object" },
        },
      },
      patch: {
        summary: "Update runtime configuration",
        description:
          "Atomically updates one or more config keys. Only known keys are accepted; unknown keys are rejected with 400.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  rateLimitPerWindow: { type: "integer" },
                  rateLimitWindowMs: { type: "integer" },
                  bulkMaxItems: { type: "integer" },
                  eventLogCap: { type: "integer" },
                  quote_ttl_ms: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated configuration object" },
          "400": { description: "Unknown key, non-integer value, or value exceeds ceiling" },
          "415": { description: "Content-Type is not `application/json`" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Pairs
    // -------------------------------------------------------------------
    "/api/v1/pairs": {
      get: {
        summary: "List registered pairs",
        description:
          "Paginated list of registered asset pairs. Supports `limit`, cursor-based pagination, and ETags.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Maximum items per page (default 100, max 500)" },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque base64-encoded pagination cursor" },
        ],
        responses: {
          "200": { description: "Paginated pairs list with nextCursor" },
          "304": { description: "Not modified (ETag match)" },
          "400": { description: "Invalid `limit` or malformed `cursor`" },
        },
      },
      head: {
        summary: "Pairs list ETag (no body)",
        description:
          "Returns only headers including an ETag for conditional requests. No response body.",
        responses: {
          "200": { description: "ETag header present" },
        },
      },
      post: {
        summary: "Register a pair",
        description:
          "Registers a new `SOURCE::DEST` asset pair in the registry. Supports `Idempotency-Key` for safe retries. Requires `Content-Type: application/json`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["source", "destination"],
                properties: {
                  source: { type: "string", description: "Source asset code (1-12 alphanumeric)" },
                  destination: { type: "string", description: "Destination asset code (1-12 alphanumeric)" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Pair registered" },
          "400": { description: "Invalid or missing `source`/`destination`" },
          "409": { description: "Pair already registered or idempotency conflict" },
          "415": { description: "Content-Type is not `application/json`" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}": {
      get: {
        summary: "Read a registered pair",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" }, description: "Source asset code" },
          { name: "destination", in: "path", required: true, schema: { type: "string" }, description: "Destination asset code" },
        ],
        responses: {
          "200": { description: "Pair details (source, destination, registered: true)" },
          "400": { description: "Invalid asset code format" },
          "404": { description: "Pair is not registered" },
        },
      },
      delete: {
        summary: "Unregister a pair",
        description:
          "Removes a registered pair from the registry. Emits a `pair.unregistered` audit event.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" }, description: "Source asset code" },
          { name: "destination", in: "path", required: true, schema: { type: "string" }, description: "Destination asset code" },
        ],
        responses: {
          "204": { description: "Pair unregistered (no body)" },
          "400": { description: "Invalid asset code format" },
          "404": { description: "Pair is not registered" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/info": {
      get: {
        summary: "Pair aggregate information",
        description:
          "Returns a single round-trip aggregate of the pair's registration status and all metadata fields (fee, min/max amounts, liquidity, rate, enabled flag).",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Aggregate pair metadata" },
          "400": { description: "Invalid asset code format" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/fee_bps": {
      patch: {
        summary: "Set fee basis points",
        description:
          "Updates the `feeBps` metadata for a registered pair. Value must be an integer in [0, 1000].",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["feeBps"], properties: { feeBps: { type: "integer" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `feeBps` value" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/min": {
      patch: {
        summary: "Set minimum amount",
        description:
          "Updates the `minAmount` metadata for a registered pair. Must be a non-negative integer string.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["minAmount"], properties: { minAmount: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `minAmount` value or cross-field constraint violation" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/max": {
      patch: {
        summary: "Set maximum amount",
        description:
          "Updates the `maxAmount` metadata for a registered pair. Must be a positive integer string.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["maxAmount"], properties: { maxAmount: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `maxAmount` value or cross-field constraint violation" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/liquidity": {
      patch: {
        summary: "Set liquidity",
        description:
          "Updates the `liquidity` metadata for a registered pair. Must be a non-negative integer string.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["liquidity"], properties: { liquidity: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `liquidity` value or cross-field constraint violation" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/rate": {
      patch: {
        summary: "Set exchange rate",
        description:
          "Updates the `rate` metadata for a registered pair. Must be a positive decimal string with at most 8 decimal places.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["rate"], properties: { rate: { type: "string" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `rate` value" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/enabled": {
      patch: {
        summary: "Toggle pair enabled flag",
        description:
          "Enables or disables a registered pair. Emits a `pair.enabled` or `pair.disabled` audit event.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } } } },
        },
        responses: {
          "200": { description: "Updated pair metadata" },
          "400": { description: "Invalid `enabled` value (must be boolean)" },
          "404": { description: "Pair is not registered" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/{source}/{destination}/reset": {
      post: {
        summary: "Reset pair metadata to defaults",
        description:
          "Resets a registered pair's metadata fields to their factory defaults. Emits a `pair.meta.reset` audit event.",
        parameters: [
          { name: "source", in: "path", required: true, schema: { type: "string" } },
          { name: "destination", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Reset pair metadata" },
          "400": { description: "Invalid asset code format" },
          "404": { description: "Pair is not registered" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/pairs/bulk": {
      post: {
        summary: "Register pairs in bulk",
        description:
          "Registers up to `bulkMaxItems` asset pairs in a single request. Requires `Content-Type: application/json`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["pairs"],
                properties: {
                  pairs: { type: "array", items: { type: "object", required: ["source", "destination"], properties: { source: { type: "string" }, destination: { type: "string" } } } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Bulk registration result (partial failures reported per-item)" },
          "400": { description: "Invalid request format or exceeds `bulkMaxItems` ceiling" },
          "413": { description: "Request body exceeds 100 kB limit" },
          "415": { description: "Content-Type is not `application/json`" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Quotes
    // -------------------------------------------------------------------
    "/api/v1/quote": {
      get: {
        summary: "Get a route quote",
        description:
          "Returns a price quote for routing a given `amount` from `source` to `destination`. Amount bounds (min/max) and liquidity limits are enforced per the pair metadata.",
        parameters: [
          { name: "source", in: "query", required: true, schema: { type: "string" }, description: "Source asset code" },
          { name: "destination", in: "query", required: true, schema: { type: "string" }, description: "Destination asset code" },
          { name: "amount", in: "query", required: true, schema: { type: "string" }, description: "Amount in base units (integer string)" },
        ],
        responses: {
          "200": { description: "Quote with fee, rate, and output amount" },
          "400": { description: "Invalid parameters or amount out of bounds" },
          "404": { description: "Pair is not registered" },
          "422": { description: "Insufficient liquidity for the requested amount" },
        },
      },
    },

    "/api/v1/quote/reverse": {
      get: {
        summary: "Reverse quote — solve input for a target output",
        description:
          "Calculates the required source amount needed to receive a specified `destinationAmount` after fees and slippage.",
        parameters: [
          { name: "source", in: "query", required: true, schema: { type: "string" } },
          { name: "destination", in: "query", required: true, schema: { type: "string" } },
          { name: "destinationAmount", in: "query", required: true, schema: { type: "string" }, description: "Target amount in base units" },
        ],
        responses: {
          "200": { description: "Reverse quote with required input amount" },
          "400": { description: "Invalid parameters or out of bounds" },
          "404": { description: "Pair is not registered" },
          "422": { description: "Insufficient liquidity" },
        },
      },
    },

    "/api/v1/quote/bulk": {
      post: {
        summary: "Bulk quote",
        description:
          "Computes quotes for a batch of source/destination/amount triples in a single request. Returns per-item results with individual success/failure indicators.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["items"],
                properties: {
                  items: { type: "array", items: { type: "object", required: ["source", "destination", "amount"], properties: { source: { type: "string" }, destination: { type: "string" }, amount: { type: "string" } } } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Bulk quote results (per-item ok/error)" },
          "400": { description: "Invalid request format or exceeds `bulkMaxItems` ceiling" },
          "413": { description: "Request body exceeds 100 kB limit" },
          "415": { description: "Content-Type is not `application/json`" },
        },
      },
    },

    // -------------------------------------------------------------------
    // API Keys
    // -------------------------------------------------------------------
    "/api/v1/api-keys": {
      get: {
        summary: "List API keys",
        description:
          "Paginated list of API keys with their prefixes, labels, and metadata. Raw keys are never exposed. Supports `limit` and cursor-based pagination.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Maximum items per page (default 100, max 500)" },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque base64-encoded pagination cursor" },
        ],
        responses: {
          "200": { description: "Paginated API key list with nextCursor" },
          "400": { description: "Invalid `limit` or malformed `cursor`" },
        },
      },
      post: {
        summary: "Create API key",
        description:
          "Creates a new `srk_`-prefixed API key with an optional label, scopes, and expiry. Supports `Idempotency-Key` for safe retries. The raw key is returned exactly once in the 201 response.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["label"],
                properties: {
                  label: { type: "string", description: "Human-readable label (1-64 chars)" },
                  scopes: { type: "array", items: { type: "string" }, description: "Scope strings (pairs:write, webhooks:write, keys:admin)" },
                  expiresInSeconds: { type: "integer", description: "Time-to-live in seconds (max 31536000 / 1 year)" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Key created — raw key returned once" },
          "400": { description: "Invalid label, scopes, or expiresInSeconds" },
          "409": { description: "Idempotency-Key conflict" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/api-keys/{prefix}": {
      delete: {
        summary: "Revoke API key by prefix",
        description:
          "Deletes an API key identified by its 8-character prefix. Emits an `apikey.deleted` audit event. Returns 204 with no body on success.",
        parameters: [
          { name: "prefix", in: "path", required: true, schema: { type: "string" }, description: "8-character key prefix (e.g. `srk_abc1`)" },
        ],
        responses: {
          "204": { description: "Key revoked (no body)" },
          "404": { description: "No key found with the given prefix" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/api-keys/{prefix}/rotate": {
      post: {
        summary: "Rotate API key",
        description:
          "Mints a new `srk_` key inheriting the predecessor's label and scopes. The predecessor remains valid for a configurable grace window (`ROTATION_GRACE_MS`, default 1 hour). The new raw key is returned exactly once.",
        parameters: [
          { name: "prefix", in: "path", required: true, schema: { type: "string" }, description: "8-character prefix of the key to rotate" },
        ],
        responses: {
          "201": { description: "New key created — raw key returned once; predecessor stamped with rotation metadata" },
          "404": { description: "No key found with the given prefix" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Webhooks
    // -------------------------------------------------------------------
    "/api/v1/webhooks": {
      get: {
        summary: "List webhooks",
        description:
          "Paginated list of registered webhook subscriptions. Supports `limit` and cursor-based pagination.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Maximum items per page (default 100, max 500)" },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque base64-encoded pagination cursor" },
        ],
        responses: {
          "200": { description: "Paginated webhook list with nextCursor" },
          "400": { description: "Invalid `limit` or malformed `cursor`" },
        },
      },
      post: {
        summary: "Register webhook",
        description:
          "Registers a new webhook subscription for one or more event types. The URL must be a public http(s) address. Supports `Idempotency-Key` for safe retries.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", description: "HTTP(S) callback URL (max 2048 chars)" },
                  events: { type: "array", items: { type: "string" }, description: "Event type names to subscribe to" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Webhook registered" },
          "400": { description: "Invalid URL format, unsafe host, or invalid event names" },
          "409": { description: "Idempotency-Key conflict" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    "/api/v1/webhooks/{id}": {
      get: {
        summary: "Read a registered webhook",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Webhook identifier (e.g. `wh_abc123`)" },
        ],
        responses: {
          "200": { description: "Webhook record (id, url, events, createdAt)" },
          "404": { description: "Webhook not found" },
        },
      },
      delete: {
        summary: "Delete webhook",
        description:
          "Removes a webhook subscription. Emits a `webhook.deleted` audit event. Returns 204 with no body on success.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "204": { description: "Webhook deleted (no body)" },
          "404": { description: "Webhook not found" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
      patch: {
        summary: "Update webhook events",
        description:
          "Updates the subscribed event types for a webhook. The URL is immutable and must be changed through delete/recreate.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["events"],
                properties: {
                  events: { type: "array", items: { type: "string" }, description: "New list of event type names" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated webhook record" },
          "400": { description: "Invalid event names" },
          "404": { description: "Webhook not found" },
          "415": { description: "Content-Type is not `application/json`" },
          "503": { description: "Service is paused or in read-only mode" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------
    "/api/v1/admin/pause": {
      post: {
        summary: "Pause service",
        description:
          "Engages the service-level pause. While paused, non-idempotent (GET/HEAD/OPTIONS) requests are rejected with 503, except the unpause endpoint itself.",
        responses: {
          "200": { description: "Service paused (confirmed)" },
          "503": { description: "Service is already paused or in read-only mode" },
        },
      },
    },

    "/api/v1/admin/unpause": {
      post: {
        summary: "Unpause service",
        description:
          "Disengages the service-level pause. Always reachable — even when paused — so operators can never be locked out.",
        responses: {
          "200": { description: "Service unpaused (confirmed)" },
        },
      },
    },

    "/api/v1/admin/read-only": {
      post: {
        summary: "Enable read-only mode",
        description:
          "Puts the service into read-only mode: GET/HEAD/OPTIONS and quote endpoints still succeed; all other mutating writes are rejected with 503.",
        responses: {
          "200": { description: "Read-only mode enabled (confirmed)" },
          "503": { description: "Service is paused" },
        },
      },
    },

    "/api/v1/admin/read-write": {
      post: {
        summary: "Disable read-only mode",
        description:
          "Returns the service to full read/write mode. Always reachable so operators can never be locked out.",
        responses: {
          "200": { description: "Read-only mode disabled (confirmed)" },
        },
      },
    },

    "/api/v1/admin/status": {
      get: {
        summary: "Service status",
        description:
          "Returns the current `paused` and `readOnly` flags so operators can confirm the service mode.",
        responses: {
          "200": { description: "Status object { paused, readOnly }" },
        },
      },
    },

    // -------------------------------------------------------------------
    // Version
    // -------------------------------------------------------------------
    "/api/v1/version": {
      get: {
        summary: "Build/version metadata",
        description:
          "Returns lightweight, unauthenticated build identity for incident confirmation. Exposes only public metadata (name, version, commit SHA, build time, Node.js version) — never secrets or internal config.",
        responses: {
          "200": { description: "Build metadata object" },
        },
      },
    },
  },
} as const;
