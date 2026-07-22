import {
  applyFee,
  applySlippage,
  checkQuoteBounds,
  priceQuote,
  priceReverseQuote,
  solveInput,
} from "../pricing";
import { defaultMeta, type PairMeta } from "../stores";

const meta = (overrides: Partial<PairMeta> = {}): PairMeta => ({
  ...defaultMeta(),
  ...overrides,
});

describe("applyFee", () => {
  it("charges no fee when feeBps is 0", () => {
    const { feeAmount, netAmount } = applyFee(1_000n, 0);
    expect(feeAmount).toBe(0n);
    expect(netAmount).toBe(1_000n);
  });

  it("computes a proportional fee for a mid-range feeBps", () => {
    // 100 bps == 1%
    const { feeAmount, netAmount } = applyFee(10_000n, 100);
    expect(feeAmount).toBe(100n);
    expect(netAmount).toBe(9_900n);
  });

  it("rounds the fee down (in the gateway's favour) on non-exact division", () => {
    // 1/3 bps of 10 -> 0.0003..., floors to 0
    const { feeAmount, netAmount } = applyFee(10n, 3);
    expect(feeAmount).toBe(0n);
    expect(netAmount).toBe(10n);

    // 999 * 30 / 10_000 = 2.997 -> floors to 2
    const fee2 = applyFee(999n, 30);
    expect(fee2.feeAmount).toBe(2n);
    expect(fee2.netAmount).toBe(997n);
  });

  it("applies the maximum allowed feeBps (1000 == 10%)", () => {
    const { feeAmount, netAmount } = applyFee(1_000n, 1000);
    expect(feeAmount).toBe(100n);
    expect(netAmount).toBe(900n);
  });

  it("preserves precision for amounts above Number.MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 7n;
    const { feeAmount, netAmount } = applyFee(huge, 50);
    expect(feeAmount).toBe((huge * 50n) / 10_000n);
    expect(netAmount).toBe(huge - feeAmount);
  });
});

describe("applySlippage", () => {
  it("returns the full amount when slippageBps is 0", () => {
    expect(applySlippage(5_000n, 0)).toBe(5_000n);
  });

  it("subtracts the proportional slippage tolerance", () => {
    // 200 bps == 2%
    expect(applySlippage(10_000n, 200)).toBe(9_800n);
  });

  it("floors the slippage amount on non-exact division", () => {
    // 7 * 3 / 10_000 = 0.0021 -> floors to 0
    expect(applySlippage(7n, 3)).toBe(7n);
  });

  it("applies the maximum allowed slippageBps (1000 == 10%)", () => {
    expect(applySlippage(1_000n, 1000)).toBe(900n);
  });

  it("preserves precision for amounts above Number.MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 11n;
    const result = applySlippage(huge, 25);
    expect(result).toBe(huge - (huge * 25n) / 10_000n);
  });
});

describe("checkQuoteBounds", () => {
  it('returns null when all bounds are unset ("0")', () => {
    expect(checkQuoteBounds(meta(), 1_000_000_000n)).toBeNull();
  });

  it("returns null when the amount sits exactly on the min boundary", () => {
    expect(checkQuoteBounds(meta({ minAmount: "100" }), 100n)).toBeNull();
  });

  it("flags an amount below minAmount as invalid_request/400", () => {
    const violation = checkQuoteBounds(meta({ minAmount: "100" }), 99n);
    expect(violation).toEqual({
      status: 400,
      error: "invalid_request",
      bulkError: "out_of_bounds",
      message: "amount (99) is below minAmount (100)",
    });
  });

  it("returns null when the amount sits exactly on the max boundary", () => {
    expect(checkQuoteBounds(meta({ maxAmount: "500" }), 500n)).toBeNull();
  });

  it("flags an amount above maxAmount as invalid_request/400", () => {
    const violation = checkQuoteBounds(meta({ maxAmount: "500" }), 501n);
    expect(violation).toEqual({
      status: 400,
      error: "invalid_request",
      bulkError: "out_of_bounds",
      message: "amount (501) exceeds maxAmount (500)",
    });
  });

  it("returns null when the amount sits exactly on the liquidity boundary", () => {
    expect(checkQuoteBounds(meta({ liquidity: "200" }), 200n)).toBeNull();
  });

  it("flags an amount above liquidity as insufficient_liquidity/422", () => {
    const violation = checkQuoteBounds(meta({ liquidity: "200" }), 201n);
    expect(violation).toEqual({
      status: 422,
      error: "insufficient_liquidity",
      bulkError: "out_of_bounds",
      message: "amount (201) exceeds available liquidity (200)",
    });
  });

  it("checks minAmount before maxAmount when both are violated", () => {
    const violation = checkQuoteBounds(
      meta({ minAmount: "100", maxAmount: "50" }),
      10n,
    );
    expect(violation?.error).toBe("invalid_request");
    expect(violation?.message).toContain("below minAmount");
  });

  it("checks maxAmount before liquidity when both are violated", () => {
    const violation = checkQuoteBounds(
      meta({ maxAmount: "50", liquidity: "10" }),
      60n,
    );
    expect(violation?.error).toBe("invalid_request");
    expect(violation?.message).toContain("exceeds maxAmount");
  });

  it("stays in BigInt space for amounts above Number.MAX_SAFE_INTEGER", () => {
    const bigLiquidity = (BigInt(Number.MAX_SAFE_INTEGER) * 10n).toString();
    const amount = BigInt(Number.MAX_SAFE_INTEGER) * 10n + 1n;
    const violation = checkQuoteBounds(
      meta({ liquidity: bigLiquidity }),
      amount,
    );
    expect(violation?.error).toBe("insufficient_liquidity");
  });
});

describe("solveInput", () => {
  it("returns the target amount unchanged (1:1 identity mapping)", () => {
    expect(solveInput(12_345n)).toBe(12_345n);
  });

  it("preserves precision for amounts above Number.MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 100n + 1n;
    expect(solveInput(huge)).toBe(huge);
  });
});

describe("priceQuote", () => {
  it("combines fee application and slippage into a single priced result", () => {
    const priced = priceQuote(meta({ feeBps: 100, rate: "1.5" }), 10_000n, 200);
    // fee: 100 bps of 10_000 = 100 -> net 9_900
    // slippage: 200 bps of 9_900 = 198 -> min received 9_702
    expect(priced).toEqual({
      feeBps: 100,
      feeAmount: 100n,
      netAmount: 9_900n,
      minReceived: 9_702n,
      rate: "1.5",
    });
  });

  it("passes through zero fee and zero slippage unchanged", () => {
    const priced = priceQuote(meta(), 42n, 0);
    expect(priced).toEqual({
      feeBps: 0,
      feeAmount: 0n,
      netAmount: 42n,
      minReceived: 42n,
      rate: "1.0",
    });
  });

  it("echoes the pair's rate and feeBps regardless of amount", () => {
    const priced = priceQuote(
      meta({ feeBps: 25, rate: "0.85" }),
      1_000_000n,
      10,
    );
    expect(priced.feeBps).toBe(25);
    expect(priced.rate).toBe("0.85");
  });
});

describe("priceReverseQuote", () => {
  it("solves for the required input and echoes the pair's rate", () => {
    const priced = priceReverseQuote(meta({ rate: "2.0" }), 5_000n);
    expect(priced).toEqual({ requiredInput: 5_000n, rate: "2.0" });
  });

  it("preserves precision for target amounts above Number.MAX_SAFE_INTEGER", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 3n;
    const priced = priceReverseQuote(meta(), huge);
    expect(priced.requiredInput).toBe(huge);
  });
});
