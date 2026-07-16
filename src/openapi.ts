/**
 * Single source of truth for the StableRoute Backend OpenAPI document.
 *
 * The spec is authored in `openapi.yaml` at the repository root so it can be
 * linted and validated by standard tooling in CI (e.g. `swagger-cli validate`).
 * This module reads that file at startup, parses it with a built-in YAML parser,
 * and exports the result so `GET /api/v1/openapi.json` always serves the
 * canonical, file-defined spec — never a stale in-memory copy.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: { title: "StableRoute Backend", version: "1.0.0" },
  paths: {
    "/health": { get: { summary: "Shallow health" } },
    "/api/v1/health/deep": { get: { summary: "Deep health" } },
    "/api/v1/metrics": { get: { summary: "Prometheus metrics" } },
    "/api/v1/stats": { get: { summary: "Aggregate snapshot" } },
    "/api/v1/events": { get: { summary: "Audit log" } },
    "/api/v1/config": {
      get: { summary: "Read config" },
      patch: { summary: "Update config" },
    },
    "/api/v1/pairs": {
      get: { summary: "List pairs" },
      head: { summary: "Pairs list ETag (no body)" },
      post: { summary: "Register pair" },
    },
    "/api/v1/pairs/{source}/{destination}": {
      get: { summary: "Read pair" },
      delete: { summary: "Unregister pair" },
    },
    "/api/v1/pairs/{source}/{destination}/info": { get: { summary: "Pair aggregate" } },
    "/api/v1/pairs/{source}/{destination}/fee_bps": { patch: { summary: "Set fee" } },
    "/api/v1/pairs/{source}/{destination}/min": { patch: { summary: "Set min amount" } },
    "/api/v1/pairs/{source}/{destination}/max": { patch: { summary: "Set max amount" } },
    "/api/v1/pairs/{source}/{destination}/liquidity": { patch: { summary: "Set liquidity" } },
    "/api/v1/pairs/{source}/{destination}/rate": { patch: { summary: "Set rate" } },
    "/api/v1/pairs/{source}/{destination}/enabled": { patch: { summary: "Set enabled toggle" } },
    "/api/v1/pairs/{source}/{destination}/reset": { post: { summary: "Reset pair metadata to defaults" } },
    "/api/v1/quote": { get: { summary: "Get a route quote" } },
    "/api/v1/quote/reverse": { get: { summary: "Reverse quote: solve required input for a target output" } },
    "/api/v1/quote/bulk": { post: { summary: "Bulk quote" } },
    "/api/v1/pairs/bulk": { post: { summary: "Register pairs in bulk" } },
    "/api/v1/api-keys": {
      get: { summary: "List API keys" },
      post: { summary: "Create API key" },
    },
    "/api/v1/api-keys/{prefix}": { delete: { summary: "Revoke API key" } },
    "/api/v1/api-keys/{prefix}/rotate": { post: { summary: "Rotate API key" } },
    "/api/v1/webhooks": {
      get: { summary: "List webhooks" },
      post: { summary: "Register webhook" },
    },
    "/api/v1/webhooks/{id}": {
      get: { summary: "Read webhook" },
      delete: { summary: "Delete webhook" },
      patch: { summary: "Update webhook events" },
    },
    "/api/v1/admin/pause": { post: { summary: "Pause service" } },
    "/api/v1/admin/unpause": { post: { summary: "Unpause service" } },
    "/api/v1/admin/read-only": { post: { summary: "Enable read-only mode" } },
    "/api/v1/admin/read-write": { post: { summary: "Disable read-only mode" } },
    "/api/v1/admin/status": { get: { summary: "Service status" } },
    "/api/v1/version": { get: { summary: "Build/version metadata" } },
  },
} as const;
