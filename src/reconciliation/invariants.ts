/**
 * Individual testable domain invariants for swap drift detection.
 *
 * @module reconciliation/invariants
 */

import type {
  SwapRecord,
  InvariantViolation,
  SwapInvariantFn,
} from "./types";

/**
 * Normalizes and converts a decimal or integer string into a BigInt
 * scaled by `targetScale` decimals.
 */
function toScaledBigInt(val: string, targetScale: number): bigint | null {
  const trimmed = val.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parts = trimmed.split(".");
  const intPart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > targetScale) {
    return null;
  }
  const paddedFrac = fracPart.padEnd(targetScale, "0");
  try {
    return BigInt(intPart) * BigInt(10 ** targetScale) + BigInt(paddedFrac);
  } catch {
    return null;
  }
}

/**
 * Invariant 1: Balance Conservation.
 *
 * The incoming amount must strictly equal the net amount plus the fee amount
 * (amountIn === netAmount + feeAmount), and all amounts must be non-negative.
 */
export const checkBalanceConservation: SwapInvariantFn = (
  swap: SwapRecord,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];

  // Check for negative signs
  if (
    swap.amountIn.trim().startsWith("-") ||
    swap.netAmount.trim().startsWith("-") ||
    swap.feeAmount.trim().startsWith("-") ||
    swap.amountOut.trim().startsWith("-")
  ) {
    violations.push({
      swapId: swap.id,
      invariant: "BALANCE_CONSERVATION",
      code: "IMBALANCE_NEGATIVE_AMOUNT",
      reason: `Swap ${swap.id} has one or more negative amount fields`,
      severity: "critical",
      details: {
        amountIn: swap.amountIn,
        netAmount: swap.netAmount,
        feeAmount: swap.feeAmount,
        amountOut: swap.amountOut,
      },
    });
    return violations;
  }

  // Determine maximum decimal scale
  const getScale = (s: string) => {
    const parts = s.trim().split(".");
    return parts.length > 1 && parts[1] ? parts[1].length : 0;
  };
  const maxScale = Math.max(
    getScale(swap.amountIn),
    getScale(swap.netAmount),
    getScale(swap.feeAmount),
  );

  const scaledIn = toScaledBigInt(swap.amountIn, maxScale);
  const scaledNet = toScaledBigInt(swap.netAmount, maxScale);
  const scaledFee = toScaledBigInt(swap.feeAmount, maxScale);

  if (scaledIn === null || scaledNet === null || scaledFee === null) {
    violations.push({
      swapId: swap.id,
      invariant: "BALANCE_CONSERVATION",
      code: "AMOUNT_INVALID_NUMERIC",
      reason: `Swap ${swap.id} has malformed or unparseable amount fields`,
      severity: "high",
      details: {
        amountIn: swap.amountIn,
        netAmount: swap.netAmount,
        feeAmount: swap.feeAmount,
      },
    });
    return violations;
  }

  if (scaledIn !== scaledNet + scaledFee) {
    violations.push({
      swapId: swap.id,
      invariant: "BALANCE_CONSERVATION",
      code: "IMBALANCE_NET_PLUS_FEE",
      reason: `Swap ${swap.id} balance imbalance: amountIn (${swap.amountIn}) !== netAmount (${swap.netAmount}) + feeAmount (${swap.feeAmount})`,
      severity: "critical",
      details: {
        amountIn: swap.amountIn,
        netAmount: swap.netAmount,
        feeAmount: swap.feeAmount,
      },
    });
  }

  return violations;
};

/**
 * Invariant 2: Status & Lifecycle Consistency.
 *
 * Terminal and intermediate statuses must reflect valid lifecycle state:
 * - "completed" requires completedAt, amountOut > 0, and no refundedAt
 * - "refunded" requires refundedAt
 * - "failed" requires failureReason and no completedAt
 * - "pending" cannot have completedAt or refundedAt
 * - Timestamps must be monotonic (updatedAt >= createdAt, completedAt >= createdAt)
 */
export const checkStatusConsistency: SwapInvariantFn = (
  swap: SwapRecord,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];

  // Timestamp monotonicity
  if (swap.updatedAt < swap.createdAt) {
    violations.push({
      swapId: swap.id,
      invariant: "STATUS_CONSISTENCY",
      code: "STATUS_TIMESTAMP_INVERSION",
      reason: `Swap ${swap.id} has updatedAt (${swap.updatedAt}) < createdAt (${swap.createdAt})`,
      severity: "high",
      details: { createdAt: swap.createdAt, updatedAt: swap.updatedAt },
    });
  }

  if (swap.completedAt !== undefined && swap.completedAt < swap.createdAt) {
    violations.push({
      swapId: swap.id,
      invariant: "STATUS_CONSISTENCY",
      code: "STATUS_TIMESTAMP_INVERSION",
      reason: `Swap ${swap.id} has completedAt (${swap.completedAt}) < createdAt (${swap.createdAt})`,
      severity: "high",
      details: { createdAt: swap.createdAt, completedAt: swap.completedAt },
    });
  }

  switch (swap.status) {
    case "completed": {
      if (swap.completedAt === undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_COMPLETED_MISSING_TIMESTAMP",
          reason: `Swap ${swap.id} marked completed but completedAt is missing`,
          severity: "high",
        });
      }
      if (swap.refundedAt !== undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_COMPLETED_HAS_REFUND",
          reason: `Swap ${swap.id} marked completed but has refundedAt timestamp`,
          severity: "critical",
          details: { refundedAt: swap.refundedAt },
        });
      }
      const numOut = Number(swap.amountOut);
      if (isNaN(numOut) || numOut <= 0) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_COMPLETED_ZERO_AMOUNT",
          reason: `Swap ${swap.id} marked completed but amountOut is zero or invalid (${swap.amountOut})`,
          severity: "critical",
          details: { amountOut: swap.amountOut },
        });
      }
      break;
    }
    case "refunded": {
      if (swap.refundedAt === undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_REFUNDED_MISSING_TIMESTAMP",
          reason: `Swap ${swap.id} marked refunded but refundedAt is missing`,
          severity: "high",
        });
      }
      break;
    }
    case "failed": {
      if (!swap.failureReason || swap.failureReason.trim() === "") {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_FAILED_MISSING_REASON",
          reason: `Swap ${swap.id} marked failed but failureReason is missing`,
          severity: "medium",
        });
      }
      if (swap.completedAt !== undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_FAILED_HAS_COMPLETION",
          reason: `Swap ${swap.id} marked failed but contains completedAt timestamp`,
          severity: "critical",
          details: { completedAt: swap.completedAt },
        });
      }
      break;
    }
    case "pending": {
      if (swap.completedAt !== undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_PENDING_HAS_COMPLETION",
          reason: `Swap ${swap.id} is pending but contains completedAt timestamp`,
          severity: "high",
          details: { completedAt: swap.completedAt },
        });
      }
      if (swap.refundedAt !== undefined) {
        violations.push({
          swapId: swap.id,
          invariant: "STATUS_CONSISTENCY",
          code: "STATUS_PENDING_HAS_REFUND",
          reason: `Swap ${swap.id} is pending but contains refundedAt timestamp`,
          severity: "high",
          details: { refundedAt: swap.refundedAt },
        });
      }
      break;
    }
    case "submitted":
      break;
  }

  return violations;
};

/**
 * Invariant 3: Rate & Numeric Integrity.
 *
 * Estimated / executed exchange rate must be strictly positive and finite.
 */
export const checkRateIntegrity: SwapInvariantFn = (
  swap: SwapRecord,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const rateNum = Number(swap.rate);

  if (isNaN(rateNum) || !isFinite(rateNum) || rateNum <= 0) {
    violations.push({
      swapId: swap.id,
      invariant: "RATE_INTEGRITY",
      code: "RATE_NON_POSITIVE",
      reason: `Swap ${swap.id} has non-positive or invalid rate (${swap.rate})`,
      severity: "high",
      details: { rate: swap.rate },
    });
  }

  return violations;
};

/**
 * Invariant 4: Route Continuity.
 *
 * For multi-hop routed swaps, the intermediate assets and amounts must chain continuously:
 * - First leg sourceAsset === swap.sourceAsset
 * - Last leg destAsset === swap.destAsset
 * - Leg[i].destAsset === Leg[i+1].sourceAsset
 * - Leg[i].amountOut === Leg[i+1].amountIn
 */
export const checkRouteContinuity: SwapInvariantFn = (
  swap: SwapRecord,
): InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const legs = swap.legs;
  if (!legs || legs.length === 0) {
    return violations;
  }

  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];

  if (firstLeg && firstLeg.sourceAsset !== swap.sourceAsset) {
    violations.push({
      swapId: swap.id,
      invariant: "ROUTE_CONTINUITY",
      code: "ROUTE_ASSET_DISCONTINUITY",
      reason: `First leg source asset (${firstLeg.sourceAsset}) does not match swap source asset (${swap.sourceAsset})`,
      severity: "high",
      details: { expected: swap.sourceAsset, actual: firstLeg.sourceAsset },
    });
  }

  if (lastLeg && lastLeg.destAsset !== swap.destAsset) {
    violations.push({
      swapId: swap.id,
      invariant: "ROUTE_CONTINUITY",
      code: "ROUTE_ASSET_DISCONTINUITY",
      reason: `Last leg destination asset (${lastLeg.destAsset}) does not match swap destination asset (${swap.destAsset})`,
      severity: "high",
      details: { expected: swap.destAsset, actual: lastLeg.destAsset },
    });
  }

  for (let i = 0; i < legs.length - 1; i++) {
    const current = legs[i];
    const next = legs[i + 1];
    if (!current || !next) continue;

    if (current.destAsset !== next.sourceAsset) {
      violations.push({
        swapId: swap.id,
        invariant: "ROUTE_CONTINUITY",
        code: "ROUTE_ASSET_DISCONTINUITY",
        reason: `Route hop ${i} -> ${i + 1} asset mismatch: ${current.destAsset} !== ${next.sourceAsset}`,
        severity: "critical",
        details: { hop: i, currentDest: current.destAsset, nextSource: next.sourceAsset },
      });
    }

    if (current.amountOut !== next.amountIn) {
      violations.push({
        swapId: swap.id,
        invariant: "ROUTE_CONTINUITY",
        code: "ROUTE_AMOUNT_DISCONTINUITY",
        reason: `Route hop ${i} -> ${i + 1} amount mismatch: ${current.amountOut} !== ${next.amountIn}`,
        severity: "critical",
        details: { hop: i, currentAmountOut: current.amountOut, nextAmountIn: next.amountIn },
      });
    }
  }

  return violations;
};

/**
 * Standard registry of default invariants verified during a reconciliation run.
 */
export const DEFAULT_SWAP_INVARIANTS: SwapInvariantFn[] = [
  checkBalanceConservation,
  checkStatusConsistency,
  checkRateIntegrity,
  checkRouteContinuity,
];
