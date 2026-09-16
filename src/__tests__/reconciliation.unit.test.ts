import {
  checkBalanceConservation,
  checkStatusConsistency,
  checkRateIntegrity,
  checkRouteContinuity,
  reconcileSwapsSync,
  runReconciliationJob,
  type SwapRecord,
} from "../reconciliation";

function makeConsistentSwap(overrides: Partial<SwapRecord> = {}): SwapRecord {
  return {
    id: "swap-100",
    sourceAsset: "USDC",
    destAsset: "EURC",
    amountIn: "1000",
    netAmount: "990",
    feeAmount: "10",
    amountOut: "910",
    rate: "0.92",
    status: "completed",
    createdAt: 10_000,
    updatedAt: 10_500,
    completedAt: 10_500,
    ...overrides,
  };
}

describe("Swap Drift Reconciliation — Unit & Invariants", () => {
  describe("Individual Invariant: checkBalanceConservation", () => {
    it("returns zero violations for balanced integer amounts", () => {
      const swap = makeConsistentSwap({
        amountIn: "5000000",
        netAmount: "4975000",
        feeAmount: "25000",
      });
      expect(checkBalanceConservation(swap)).toEqual([]);
    });

    it("returns zero violations for balanced decimal amounts", () => {
      const swap = makeConsistentSwap({
        amountIn: "100.50",
        netAmount: "99.25",
        feeAmount: "1.25",
      });
      expect(checkBalanceConservation(swap)).toEqual([]);
    });

    it("flags imbalance when amountIn does not match netAmount + feeAmount", () => {
      const swap = makeConsistentSwap({
        id: "swap-bad-balance",
        amountIn: "1000",
        netAmount: "900",
        feeAmount: "50", // sums to 950, 50 missing!
      });
      const violations = checkBalanceConservation(swap);
      expect(violations).toHaveLength(1);
      const v = violations[0];
      expect(v?.code).toBe("IMBALANCE_NET_PLUS_FEE");
      expect(v?.swapId).toBe("swap-bad-balance");
      expect(v?.severity).toBe("critical");
    });

    it("flags negative amount values", () => {
      const swap = makeConsistentSwap({
        id: "swap-negative-fee",
        amountIn: "1000",
        netAmount: "1010",
        feeAmount: "-10",
      });
      const violations = checkBalanceConservation(swap);
      expect(violations).toHaveLength(1);
      const v = violations[0];
      expect(v?.code).toBe("IMBALANCE_NEGATIVE_AMOUNT");
      expect(v?.swapId).toBe("swap-negative-fee");
    });

    it("flags unparseable amount strings", () => {
      const swap = makeConsistentSwap({
        id: "swap-nan",
        amountIn: "not_a_number",
        netAmount: "100",
        feeAmount: "10",
      });
      const violations = checkBalanceConservation(swap);
      expect(violations).toHaveLength(1);
      const v = violations[0];
      expect(v?.code).toBe("AMOUNT_INVALID_NUMERIC");
    });
  });

  describe("Individual Invariant: checkStatusConsistency", () => {
    it("flags completed swap without completedAt timestamp", () => {
      const swap = makeConsistentSwap({
        id: "swap-missing-comp-time",
        status: "completed",
        completedAt: undefined,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_COMPLETED_MISSING_TIMESTAMP")).toBe(true);
    });

    it("flags completed swap with zero or negative amountOut", () => {
      const swap = makeConsistentSwap({
        id: "swap-zero-out",
        status: "completed",
        amountOut: "0",
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_COMPLETED_ZERO_AMOUNT")).toBe(true);
    });

    it("flags completed swap that also has a refundedAt timestamp", () => {
      const swap = makeConsistentSwap({
        id: "swap-comp-and-refund",
        status: "completed",
        refundedAt: 10_600,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_COMPLETED_HAS_REFUND")).toBe(true);
    });

    it("flags refunded swap without refundedAt", () => {
      const swap = makeConsistentSwap({
        id: "swap-no-refund-time",
        status: "refunded",
        completedAt: undefined,
        refundedAt: undefined,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_REFUNDED_MISSING_TIMESTAMP")).toBe(true);
    });

    it("flags failed swap without failureReason or with completedAt", () => {
      const swap = makeConsistentSwap({
        id: "swap-failed-inconsistent",
        status: "failed",
        failureReason: undefined,
        completedAt: 10_500,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_FAILED_MISSING_REASON")).toBe(true);
      expect(violations.some((v) => v.code === "STATUS_FAILED_HAS_COMPLETION")).toBe(true);
    });

    it("flags pending swap with terminal timestamps", () => {
      const swap = makeConsistentSwap({
        id: "swap-pending-corrupt",
        status: "pending",
        completedAt: 10_500,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_PENDING_HAS_COMPLETION")).toBe(true);
    });

    it("flags timestamp inversions (updatedAt < createdAt)", () => {
      const swap = makeConsistentSwap({
        id: "swap-time-travel",
        createdAt: 20_000,
        updatedAt: 10_000,
      });
      const violations = checkStatusConsistency(swap);
      expect(violations.some((v) => v.code === "STATUS_TIMESTAMP_INVERSION")).toBe(true);
    });
  });

  describe("Individual Invariant: checkRateIntegrity", () => {
    it("flags non-positive or non-numeric rates", () => {
      const swapZero = makeConsistentSwap({ id: "s-0", rate: "0" });
      const swapNeg = makeConsistentSwap({ id: "s-neg", rate: "-0.5" });
      const swapNan = makeConsistentSwap({ id: "s-nan", rate: "bad" });

      expect(checkRateIntegrity(swapZero)[0]?.code).toBe("RATE_NON_POSITIVE");
      expect(checkRateIntegrity(swapNeg)[0]?.code).toBe("RATE_NON_POSITIVE");
      expect(checkRateIntegrity(swapNan)[0]?.code).toBe("RATE_NON_POSITIVE");
    });
  });

  describe("Individual Invariant: checkRouteContinuity", () => {
    it("returns zero violations for a continuous multi-hop route", () => {
      const swap = makeConsistentSwap({
        sourceAsset: "USDC",
        destAsset: "XLM",
        legs: [
          { sourceAsset: "USDC", destAsset: "EURC", amountIn: "1000", amountOut: "920" },
          { sourceAsset: "EURC", destAsset: "XLM", amountIn: "920", amountOut: "8000" },
        ],
      });
      expect(checkRouteContinuity(swap)).toEqual([]);
    });

    it("flags asset and amount discontinuity between hops", () => {
      const swap = makeConsistentSwap({
        id: "swap-broken-hop",
        sourceAsset: "USDC",
        destAsset: "XLM",
        legs: [
          { sourceAsset: "USDC", destAsset: "EURC", amountIn: "1000", amountOut: "920" },
          { sourceAsset: "BTC", destAsset: "XLM", amountIn: "900", amountOut: "8000" }, // EURC != BTC, 920 != 900
        ],
      });
      const violations = checkRouteContinuity(swap);
      expect(violations.some((v) => v.code === "ROUTE_ASSET_DISCONTINUITY")).toBe(true);
      expect(violations.some((v) => v.code === "ROUTE_AMOUNT_DISCONTINUITY")).toBe(true);
    });
  });

  describe("Core Edge Cases (Issue #556 Requirements)", () => {
    // Edge case 1: consistent data -> zero violations
    it("edge case 1: consistent data -> zero violations", () => {
      const dataset: SwapRecord[] = [
        makeConsistentSwap({ id: "swap-1" }),
        makeConsistentSwap({ id: "swap-2", amountIn: "500", netAmount: "495", feeAmount: "5" }),
        makeConsistentSwap({
          id: "swap-3",
          status: "refunded",
          completedAt: undefined,
          refundedAt: 12_000,
        }),
      ];

      const report = reconcileSwapsSync(dataset);

      expect(report.summary.consistent).toBe(true);
      expect(report.violationCount).toBe(0);
      expect(report.violations).toHaveLength(0);
      expect(report.totalScanned).toBe(3);
      expect(report.summary.driftRate).toBe(0);
    });

    // Edge case 2: an injected imbalance -> reported with the offending id
    it("edge case 2: an injected imbalance -> reported with the offending id", () => {
      const dataset: SwapRecord[] = [
        makeConsistentSwap({ id: "swap-clean-1" }),
        makeConsistentSwap({
          id: "swap-imbalanced-42",
          amountIn: "10000",
          netAmount: "9500",
          feeAmount: "100", // sum = 9600, missing 400!
        }),
        makeConsistentSwap({ id: "swap-clean-2" }),
      ];

      const report = reconcileSwapsSync(dataset);

      expect(report.summary.consistent).toBe(false);
      expect(report.violationCount).toBe(1);
      const violation = report.violations[0];
      expect(violation?.swapId).toBe("swap-imbalanced-42");
      expect(violation?.code).toBe("IMBALANCE_NET_PLUS_FEE");
      expect(report.violationsByInvariant["BALANCE_CONSERVATION"]).toBe(1);
      expect(report.summary.driftRate).toBeCloseTo(1 / 3, 2);
    });

    // Edge case 3: an inconsistent status -> reported with offending id
    it("edge case 3: an inconsistent status -> reported with offending id", () => {
      const dataset: SwapRecord[] = [
        makeConsistentSwap({ id: "swap-clean-1" }),
        makeConsistentSwap({
          id: "swap-corrupt-status-77",
          status: "completed",
          completedAt: undefined, // Missing timestamp
        }),
      ];

      const report = reconcileSwapsSync(dataset);

      expect(report.summary.consistent).toBe(false);
      const violation = report.violations.find((v) => v.swapId === "swap-corrupt-status-77");
      expect(violation).toBeDefined();
      expect(violation?.code).toBe("STATUS_COMPLETED_MISSING_TIMESTAMP");
    });

    // Edge case 4: large dataset -> scan stays bounded
    it("edge case 4: large dataset -> scan stays bounded", () => {
      const totalDatasetSize = 1_000;
      const maxLimit = 250;
      const largeDataset: SwapRecord[] = Array.from({ length: totalDatasetSize }, (_, i) =>
        makeConsistentSwap({ id: `swap-${i}` }),
      );

      const report = reconcileSwapsSync(largeDataset, {
        maxRecords: maxLimit,
        chunkSize: 50,
      });

      expect(report.totalScanned).toBe(maxLimit);
      expect(report.isBoundedLimitReached).toBe(true);
      expect(report.chunksProcessed).toBe(5); // 250 / 50 = 5 chunks
    });

    // Edge case 5: the report is deterministic
    it("edge case 5: the report is deterministic across multiple runs", () => {
      const dataset: SwapRecord[] = [
        makeConsistentSwap({
          id: "swap-b",
          amountIn: "1000",
          netAmount: "900",
          feeAmount: "50",
        }),
        makeConsistentSwap({
          id: "swap-a",
          status: "completed",
          completedAt: undefined,
        }),
        makeConsistentSwap({
          id: "swap-c",
          rate: "-1",
        }),
      ];

      const run1 = reconcileSwapsSync(dataset, { now: 1_000_000, jobId: "fixed-job-id" });
      const run2 = reconcileSwapsSync(dataset, { now: 1_000_000, jobId: "fixed-job-id" });

      expect(run1).toEqual(run2);
      // Verify alphabetical order by swapId
      expect(run1.violations.map((v) => v.swapId)).toEqual([
        "swap-a",
        "swap-b",
        "swap-c",
      ]);
    });

    it("verifies scan is strictly side-effect-free (no mutation)", () => {
      const original: SwapRecord = makeConsistentSwap({ id: "swap-unmutated" });
      const cloned = JSON.parse(JSON.stringify(original));

      reconcileSwapsSync([original]);

      expect(original).toEqual(cloned);
    });

    it("supports asynchronous execution via runReconciliationJob", async () => {
      const dataset = [
        makeConsistentSwap({ id: "async-1" }),
        makeConsistentSwap({ id: "async-2", amountIn: "100", netAmount: "80", feeAmount: "10" }),
      ];

      const report = await runReconciliationJob(Promise.resolve(dataset));

      expect(report.totalScanned).toBe(2);
      expect(report.violationCount).toBe(1);
      expect(report.violations[0]?.swapId).toBe("async-2");
    });
  });
});
