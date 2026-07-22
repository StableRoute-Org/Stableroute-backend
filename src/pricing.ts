/**
 * Pure, dependency-free quote pricing math.
 *
 * Every function here operates only on plain values (`bigint`, `number`,
 * `PairMeta`) and has no side effects, no I/O, and no dependency on Express,
 * the in-memory stores, or any other runtime state. This lets the pricing
 * rules be unit-tested directly instead of only through HTTP-level tests,
 * and keeps the forward-quote, reverse-quote, and bulk-quote handlers in
 * `src/index.ts` sharing a single implementation instead of three copies.
 */

import type { PairMeta } from "./stores";

/** Fee breakdown for a priced amount. */
export type FeeBreakdown = {
  feeAmount: bigint;
  netAmount: bigint;
};

/** Full priced result for a forward quote (source amount -> dest amount). */
export type PricedQuote = {
  feeBps: number;
  feeAmount: bigint;
  netAmount: bigint;
  minReceived: bigint;
  rate: string;
};

/** Priced result for a reverse quote (target dest amount -> required source amount). */
export type PricedReverseQuote = {
  requiredInput: bigint;
  rate: string;
};

export type QuoteBoundsViolation = {
  status: 400 | 422;
  error: "invalid_request" | "insufficient_liquidity";
  bulkError: "out_of_bounds";
  message: string;
};

/**
 * Compute the fee breakdown for a given amount and fee rate.
 *
 * Arithmetic is performed entirely with `BigInt` to preserve precision on
 * amounts above `Number.MAX_SAFE_INTEGER`. Fees are rounded **down** (in the
 * gateway's favour) via integer division. The resulting `netAmount` is
 * always non-negative: `netAmount = amount - feeAmount`.
 *
 * @param amount  - The gross amount in base units (must be > 0n).
 * @param feeBps  - Fee rate in basis points (0-1000, where 10000 bps = 100 %).
 * @returns An object with `feeAmount` and `netAmount` as `bigint` values.
 */
export const applyFee = (amount: bigint, feeBps: number): FeeBreakdown => {
  const feeAmount = (amount * BigInt(feeBps)) / 10_000n;
  const netAmount = amount - feeAmount;
  return { feeAmount, netAmount };
};

/**
 * Compute the minimum received amount after applying slippage tolerance.
 *
 * Uses BigInt arithmetic to preserve precision on amounts above
 * Number.MAX_SAFE_INTEGER. The formula is:
 *   min_received = amount - floor(amount * slippageBps / 10_000)
 *
 * @param amount      - The output amount to apply slippage against (must be > 0n).
 * @param slippageBps - Slippage tolerance in basis points (0-1000).
 * @returns The minimum guaranteed received amount.
 */
export const applySlippage = (amount: bigint, slippageBps: number): bigint => {
  const slippageAmount = (amount * BigInt(slippageBps)) / 10_000n;
  return amount - slippageAmount;
};

/**
 * Validate a quote amount against per-pair min/max/liquidity metadata.
 *
 * The metadata value "0" means the bound is unset. All comparisons stay in
 * BigInt space so large base-unit amounts are never coerced through Number.
 *
 * @param meta   - Pair metadata carrying the min/max/liquidity bounds.
 * @param amount - The requested amount in base units.
 * @returns A violation describing the offending bound, or `null` when in range.
 */
export const checkQuoteBounds = (
  meta: PairMeta,
  amount: bigint,
): QuoteBoundsViolation | null => {
  const minAmount = BigInt(meta.minAmount);
  if (minAmount !== 0n && amount < minAmount) {
    return {
      status: 400,
      error: "invalid_request",
      bulkError: "out_of_bounds",
      message: `amount (${amount}) is below minAmount (${minAmount})`,
    };
  }

  const maxAmount = BigInt(meta.maxAmount);
  if (maxAmount !== 0n && amount > maxAmount) {
    return {
      status: 400,
      error: "invalid_request",
      bulkError: "out_of_bounds",
      message: `amount (${amount}) exceeds maxAmount (${maxAmount})`,
    };
  }

  const liquidity = BigInt(meta.liquidity);
  if (liquidity !== 0n && amount > liquidity) {
    return {
      status: 422,
      error: "insufficient_liquidity",
      bulkError: "out_of_bounds",
      message: `amount (${amount}) exceeds available liquidity (${liquidity})`,
    };
  }

  return null;
};

/**
 * Solve for the required input amount given a target output amount.
 *
 * Currently implements a 1:1 identity mapping (input equals target), but is
 * structured to allow rates, fees, or other adjustments to be layered in
 * later without changing callers.
 *
 * @param target - The target output amount in base units.
 * @returns The required gross input amount in base units.
 */
export const solveInput = (target: bigint): bigint => {
  return target;
};

/**
 * Price a forward quote: apply the pair's fee to `amount`, then apply
 * `slippageBps` tolerance to the net amount.
 *
 * Does not check bounds; callers should run {@link checkQuoteBounds} first
 * and short-circuit on a violation.
 *
 * @param meta        - Pair metadata carrying `feeBps` and `rate`.
 * @param amount      - The gross source amount in base units (must be > 0n).
 * @param slippageBps - Slippage tolerance in basis points (0-1000).
 * @returns The fee, net amount, minimum received, and echoed fee/rate.
 */
export const priceQuote = (
  meta: PairMeta,
  amount: bigint,
  slippageBps: number,
): PricedQuote => {
  const { feeAmount, netAmount } = applyFee(amount, meta.feeBps);
  const minReceived = applySlippage(netAmount, slippageBps);
  return {
    feeBps: meta.feeBps,
    feeAmount,
    netAmount,
    minReceived,
    rate: meta.rate,
  };
};

/**
 * Price a reverse quote: solve for the required source input given a target
 * destination amount.
 *
 * @param meta         - Pair metadata carrying `rate`.
 * @param targetAmount - The desired destination amount in base units.
 * @returns The required source input and the echoed rate.
 */
export const priceReverseQuote = (
  meta: PairMeta,
  targetAmount: bigint,
): PricedReverseQuote => {
  return {
    requiredInput: solveInput(targetAmount),
    rate: meta.rate,
  };
};
