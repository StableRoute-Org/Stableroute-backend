/**
 * Cryptographic request fingerprinting for idempotency conflict detection.
 *
 * A fingerprint uniquely binds the idempotency key to the specific operation,
 * endpoint, tenant scope, and payload content.
 *
 * @module idempotency/fingerprint
 */

import { createHash } from "node:crypto";

/**
 * Recursively canonicalize arbitrary JSON data by sorting object keys.
 *
 * Ensures that `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce identical serialized
 * representations, preventing false-positive conflict detections due to key ordering.
 */
export const canonicalizeJson = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    result[k] = canonicalizeJson(obj[k]);
  }
  return result;
};

/**
 * Compute the SHA-256 fingerprint for an incoming request.
 *
 * Fingerprint formula:
 * `SHA256(METHOD:path:tenantId:canonicalizedJsonBody)`
 *
 * @param method   - HTTP method in uppercase (e.g. "POST").
 * @param path     - Normalized request path (e.g. "/api/v1/swaps").
 * @param tenantId - Tenant / API key identifier.
 * @param body     - Raw or parsed request body.
 * @returns Hex-encoded SHA-256 digest string.
 */
export const computeFingerprint = (
  method: string,
  path: string,
  tenantId: string,
  body: unknown,
): string => {
  const canonicalBody = JSON.stringify(canonicalizeJson(body ?? null));
  const payload = `${method.toUpperCase()}:${path}:${tenantId}:${canonicalBody}`;
  return createHash("sha256").update(payload).digest("hex");
};
