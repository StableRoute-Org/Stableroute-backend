/**
 * Types and interfaces for the Swap Drift Reconciliation subsystem.
 *
 * @module reconciliation/types
 */

export type SwapStatus =
  | "pending"
  | "submitted"
  | "completed"
  | "failed"
  | "refunded";

export interface SwapLeg {
  sourceAsset: string;
  destAsset: string;
  amountIn: string;
  amountOut: string;
}

export interface SwapRecord {
  id: string;
  tenantId?: string | undefined;
  sourceAsset: string;
  destAsset: string;
  amountIn: string;
  amountOut: string;
  feeAmount: string;
  netAmount: string;
  rate: string;
  status: SwapStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | undefined;
  refundedAt?: number | undefined;
  failureReason?: string | undefined;
  legs?: SwapLeg[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type DriftViolationCode =
  | "IMBALANCE_NET_PLUS_FEE"
  | "IMBALANCE_NEGATIVE_AMOUNT"
  | "STATUS_COMPLETED_MISSING_TIMESTAMP"
  | "STATUS_COMPLETED_ZERO_AMOUNT"
  | "STATUS_COMPLETED_HAS_REFUND"
  | "STATUS_REFUNDED_MISSING_TIMESTAMP"
  | "STATUS_FAILED_MISSING_REASON"
  | "STATUS_FAILED_HAS_COMPLETION"
  | "STATUS_PENDING_HAS_COMPLETION"
  | "STATUS_PENDING_HAS_REFUND"
  | "STATUS_TIMESTAMP_INVERSION"
  | "RATE_NON_POSITIVE"
  | "AMOUNT_INVALID_NUMERIC"
  | "ROUTE_ASSET_DISCONTINUITY"
  | "ROUTE_AMOUNT_DISCONTINUITY";

export interface InvariantViolation {
  swapId: string;
  invariant: string;
  code: DriftViolationCode;
  reason: string;
  severity: "critical" | "high" | "medium";
  details?: Record<string, unknown> | undefined;
}

export type SwapInvariantFn = (
  swap: SwapRecord,
) => InvariantViolation[];

export interface ReconciliationJobOptions {
  /** Maximum number of records to process per iteration/chunk. Defaults to 200. */
  chunkSize?: number | undefined;
  /** Hard cap on the total number of records to scan. Defaults to 10,000. */
  maxRecords?: number | undefined;
  /** Invariant verification functions to execute. Defaults to all default invariants. */
  invariants?: SwapInvariantFn[] | undefined;
  /** Optional custom identifier for the job run. */
  jobId?: string | undefined;
  /** Injectable timestamp for deterministic testing. */
  now?: number | undefined;
}

export interface ReconciliationReport {
  jobId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  totalScanned: number;
  chunksProcessed: number;
  isBoundedLimitReached: boolean;
  violationCount: number;
  violationsByInvariant: Record<string, number>;
  violationsBySeverity: Record<string, number>;
  violations: InvariantViolation[];
  summary: {
    consistent: boolean;
    totalRecords: number;
    driftRate: number;
  };
}
