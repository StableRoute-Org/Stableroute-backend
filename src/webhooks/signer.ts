/**
 * HMAC-SHA256 signature generation and verification for webhook payloads.
 *
 * Implements industry-standard signature schemes (Stripe/GitHub style)
 * providing timestamp replay defense and cryptographic tamper detection.
 *
 * @module webhooks/signer
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookSignature } from "./types";

/**
 * Default clock drift tolerance in seconds (5 minutes).
 */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Sign a webhook payload using HMAC-SHA256 with the webhook's secret.
 *
 * The signature is computed over `${timestamp}.${payload}` so that
 * the timestamp is bound cryptographically to the exact payload content,
 * defeating replay and tampering attacks.
 *
 * @param payload   - The raw JSON payload string to sign.
 * @param secret    - The secret key associated with the webhook subscription.
 * @param timestamp - Optional epoch-ms timestamp (defaults to `Date.now()`).
 * @returns WebhookSignature carrying the hex digest, timestamp, and formatted header.
 */
export const signWebhookPayload = (
  payload: string,
  secret: string,
  timestamp: number = Date.now(),
): WebhookSignature => {
  const dataToSign = `${timestamp}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(dataToSign)
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;

  return {
    signature,
    timestamp,
    header,
  };
};

/**
 * Parse an `X-Signature` header string formatted as `t=<timestamp>,v1=<signature>`.
 *
 * @param header - Raw header value.
 * @returns Parsed timestamp and signature components, or null if malformed.
 */
export const parseSignatureHeader = (
  header: string,
): { timestamp: number; signature: string } | null => {
  if (typeof header !== "string" || header.trim().length === 0) {
    return null;
  }

  let timestamp: number | null = null;
  let signature: string | null = null;

  const parts = header.split(",");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();

    if (key === "t") {
      const parsedTs = parseInt(val, 10);
      if (Number.isFinite(parsedTs) && parsedTs > 0) {
        timestamp = parsedTs;
      }
    } else if (key === "v1") {
      if (/^[0-9a-fA-F]{64}$/.test(val)) {
        signature = val.toLowerCase();
      }
    }
  }

  if (timestamp === null || signature === null) {
    return null;
  }

  return { timestamp, signature };
};

/**
 * Verify a webhook payload against an incoming `X-Signature` header and secret.
 *
 * Defends against:
 * 1. Payload tampering: HMAC digest mismatch returns false.
 * 2. Replay attacks: Rejects requests whose timestamp falls outside `toleranceSeconds`.
 * 3. Timing attacks: Uses constant-time `timingSafeEqual` for byte comparison.
 *
 * @param payload          - The raw body content received (string or Buffer).
 * @param signatureHeader  - The incoming `X-Signature` header value.
 * @param secret           - The shared webhook signing secret.
 * @param toleranceSeconds - Maximum allowed age of the signature in seconds (default 300).
 *                           Pass 0 to disable timestamp freshness checks.
 * @returns `true` if signature and timestamp are valid, `false` otherwise.
 */
export const verifyWebhookSignature = (
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
): boolean => {
  if (!secret || typeof secret !== "string") {
    return false;
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return false;
  }

  const { timestamp, signature } = parsed;

  // Verify timestamp freshness if tolerance is configured (> 0)
  if (toleranceSeconds > 0) {
    const ageSeconds = (Date.now() - timestamp) / 1000;
    if (ageSeconds > toleranceSeconds || ageSeconds < -toleranceSeconds) {
      return false;
    }
  }

  // Compute expected HMAC
  const payloadString =
    typeof payload === "string" ? payload : payload.toString("utf8");
  const dataToSign = `${timestamp}.${payloadString}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(dataToSign)
    .digest("hex");

  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const candidateBuf = Buffer.from(signature, "utf8");

  if (expectedBuf.length !== candidateBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, candidateBuf);
};
