# Swap Drift Reconciliation Subsystem

## Overview

In financial routing and swap engines, state drift and calculation inconsistencies compound into silent financial losses. The Swap Drift Reconciliation subsystem provides a deterministic, bounded, chunked, and side-effect-free audit routine to scan swap records, detect invariant violations, and generate structured drift reports.

---

## Core Invariants

The reconciliation engine verifies four primary financial and lifecycle invariants:

### 1. Balance Conservation (`BALANCE_CONSERVATION`)
* **Rule**: Incoming asset amounts must equal the net swapped amount plus the routing fee:
  $$\text{amountIn} = \text{netAmount} + \text{feeAmount}$$
* **Numeric Scale**: Supports both integer base units and arbitrary-precision decimal strings without floating-point rounding errors via exact scaled BigInt arithmetic.
* **Non-Negativity**: Rejects any negative amount or fee representation (`IMBALANCE_NEGATIVE_AMOUNT`).

### 2. Status & Lifecycle Integrity (`STATUS_CONSISTENCY`)
* **Completed State**: Requires a valid `completedAt` timestamp, positive `amountOut` (`STATUS_COMPLETED_ZERO_AMOUNT`), and cannot contain a `refundedAt` timestamp (`STATUS_COMPLETED_HAS_REFUND`).
* **Refunded State**: Requires a valid `refundedAt` timestamp (`STATUS_REFUNDED_MISSING_TIMESTAMP`).
* **Failed State**: Requires a non-empty `failureReason` (`STATUS_FAILED_MISSING_REASON`) and forbids a `completedAt` timestamp (`STATUS_FAILED_HAS_COMPLETION`).
* **Pending State**: Forbids terminal timestamps (`STATUS_PENDING_HAS_COMPLETION`, `STATUS_PENDING_HAS_REFUND`).
* **Monotonic Timestamps**: Enforces that `updatedAt >= createdAt` and `completedAt >= createdAt` (`STATUS_TIMESTAMP_INVERSION`).

### 3. Rate & Numeric Integrity (`RATE_INTEGRITY`)
* **Rule**: Exchange rates must be finite, non-zero, and positive numbers (`RATE_NON_POSITIVE`).
* **Amounts**: All amounts must parse into valid numeric representations (`AMOUNT_INVALID_NUMERIC`).

### 4. Route Leg Continuity (`ROUTE_CONTINUITY`)
* **Hop Chaining**: For multi-hop routes (`swap.legs`):
  - `legs[0].sourceAsset` must match `swap.sourceAsset`.
  - `legs[N-1].destAsset` must match `swap.destAsset`.
  - For each intermediate hop $i$: $\text{destAsset}_i = \text{sourceAsset}_{i+1}$ (`ROUTE_ASSET_DISCONTINUITY`).
  - Intermediate output must equal next input: $\text{amountOut}_i = \text{amountIn}_{i+1}$ (`ROUTE_AMOUNT_DISCONTINUITY`).

---

## Engine Guarantees

1. **Bounded Execution**:
   - The scan enforces a maximum limit via `maxRecords` (defaults to 10,000).
   - If the dataset exceeds this limit, scanning terminates cleanly, flagging `isBoundedLimitReached: true` to prevent resource starvation or CPU spikes.

2. **Chunked Processing**:
   - Records are consumed in discrete chunks (default 200 per chunk), allowing for stream processing and minimal memory footprint.

3. **Side-Effect-Free**:
   - The reconciliation process is read-only. It never mutates input records, databases, or memory stores.

4. **Deterministic Reporting**:
   - Violations are deterministically sorted by `swapId` ascending, then `invariant` ascending, then `code` ascending.
   - Multiple runs against the same dataset produce byte-identical reports.

---

## API Reference

### `POST /api/v1/admin/reconciliation/swaps`

Runs a reconciliation scan over an array of swap records. Protected by `ADMIN_TOKEN` when configured.

#### Request Body
```json
{
  "records": [
    {
      "id": "swap-100",
      "sourceAsset": "USDC",
      "destAsset": "EURC",
      "amountIn": "1000",
      "netAmount": "990",
      "feeAmount": "10",
      "amountOut": "915",
      "rate": "0.92",
      "status": "completed",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000500,
      "completedAt": 1700000000500
    }
  ],
  "chunkSize": 200,
  "maxRecords": 10000
}
```

#### Response (200 OK)
```json
{
  "jobId": "recon-9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "startedAt": 1700000001000,
  "completedAt": 1700000001015,
  "durationMs": 15,
  "totalScanned": 1,
  "chunksProcessed": 1,
  "isBoundedLimitReached": false,
  "violationCount": 0,
  "violationsByInvariant": {},
  "violationsBySeverity": {},
  "violations": [],
  "summary": {
    "consistent": true,
    "totalRecords": 1,
    "driftRate": 0
  }
}
```

---

## Programmatic Usage

```typescript
import {
  reconcileSwapsSync,
  runReconciliationJob,
  type SwapRecord,
} from "stableroute-backend";

// Synchronous execution over in-memory records
const report = reconcileSwapsSync(swapRecords, {
  chunkSize: 100,
  maxRecords: 5000,
});

if (!report.summary.consistent) {
  console.error(`Detected ${report.violationCount} invariant violations!`);
  for (const violation of report.violations) {
    console.error(`[${violation.severity}] Swap ${violation.swapId}: ${violation.reason}`);
  }
}
```
