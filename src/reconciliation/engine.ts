/**
 * Core reconciliation scan engine.
 *
 * Provides bounded, chunked, side-effect-free, and deterministic drift detection
 * across collections of swap records.
 *
 * @module reconciliation/engine
 */

import { randomUUID } from "node:crypto";
import { DEFAULT_SWAP_INVARIANTS } from "./invariants";
import type {
  SwapRecord,
  InvariantViolation,
  ReconciliationJobOptions,
  ReconciliationReport,
} from "./types";

const DEFAULT_CHUNK_SIZE = 200;
const DEFAULT_MAX_RECORDS = 10_000;

/**
 * Sorts violations deterministically by swapId, then invariant, then code.
 */
function sortViolationsDeterministically(
  violations: InvariantViolation[],
): InvariantViolation[] {
  return [...violations].sort((a, b) => {
    if (a.swapId !== b.swapId) {
      return a.swapId.localeCompare(b.swapId);
    }
    if (a.invariant !== b.invariant) {
      return a.invariant.localeCompare(b.invariant);
    }
    return a.code.localeCompare(b.code);
  });
}

/**
 * Reconciles an in-memory iterable or array of swap records synchronously.
 *
 * Guarantees:
 * - Side-effect free: Never mutates records or store state.
 * - Bounded: Stops evaluation when `maxRecords` is reached.
 * - Deterministic: Produces identical reports for identical inputs.
 */
export function reconcileSwapsSync(
  records: Iterable<SwapRecord>,
  options?: ReconciliationJobOptions,
): ReconciliationReport {
  const startedAt = options?.now ?? Date.now();
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const invariants = options?.invariants ?? DEFAULT_SWAP_INVARIANTS;
  const jobId = options?.jobId ?? `recon-${randomUUID()}`;

  let totalScanned = 0;
  let chunksProcessed = 0;
  let isBoundedLimitReached = false;
  const rawViolations: InvariantViolation[] = [];
  const violationsByInvariant: Record<string, number> = {};
  const violationsBySeverity: Record<string, number> = {};

  let currentChunk: SwapRecord[] = [];

  const processChunk = (chunk: SwapRecord[]) => {
    if (chunk.length === 0) return;
    chunksProcessed++;
    for (const record of chunk) {
      for (const invariantFn of invariants) {
        const detected = invariantFn(record);
        for (const violation of detected) {
          rawViolations.push(violation);
          violationsByInvariant[violation.invariant] =
            (violationsByInvariant[violation.invariant] ?? 0) + 1;
          violationsBySeverity[violation.severity] =
            (violationsBySeverity[violation.severity] ?? 0) + 1;
        }
      }
    }
  };

  for (const record of records) {
    if (totalScanned >= maxRecords) {
      isBoundedLimitReached = true;
      break;
    }

    currentChunk.push(record);
    totalScanned++;

    if (currentChunk.length >= chunkSize) {
      processChunk(currentChunk);
      currentChunk = [];
    }
  }

  // Process any remaining records in the last chunk
  if (currentChunk.length > 0) {
    processChunk(currentChunk);
  }

  const completedAt = options?.now ?? Date.now();
  const violations = sortViolationsDeterministically(rawViolations);

  // Distinct count of corrupt swap records
  const offendingSwapIds = new Set(violations.map((v) => v.swapId));
  const driftRate =
    totalScanned > 0 ? offendingSwapIds.size / totalScanned : 0;

  return {
    jobId,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    totalScanned,
    chunksProcessed,
    isBoundedLimitReached,
    violationCount: violations.length,
    violationsByInvariant,
    violationsBySeverity,
    violations,
    summary: {
      consistent: violations.length === 0,
      totalRecords: totalScanned,
      driftRate: Math.round(driftRate * 10_000) / 10_000,
    },
  };
}

/**
 * Callable reconciliation job for asynchronous data sources or streams.
 */
export async function runReconciliationJob(
  recordsSource:
    | Iterable<SwapRecord>
    | AsyncIterable<SwapRecord>
    | Promise<SwapRecord[]>,
  options?: ReconciliationJobOptions,
): Promise<ReconciliationReport> {
  const resolved = await recordsSource;

  // If already an array or standard synchronous iterable
  if (Symbol.iterator in resolved) {
    return reconcileSwapsSync(resolved as Iterable<SwapRecord>, options);
  }

  // Handle AsyncIterable
  const startedAt = options?.now ?? Date.now();
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  const invariants = options?.invariants ?? DEFAULT_SWAP_INVARIANTS;
  const jobId = options?.jobId ?? `recon-${randomUUID()}`;

  let totalScanned = 0;
  let chunksProcessed = 0;
  let isBoundedLimitReached = false;
  const rawViolations: InvariantViolation[] = [];
  const violationsByInvariant: Record<string, number> = {};
  const violationsBySeverity: Record<string, number> = {};

  let currentChunk: SwapRecord[] = [];

  const processChunk = (chunk: SwapRecord[]) => {
    if (chunk.length === 0) return;
    chunksProcessed++;
    for (const record of chunk) {
      for (const invariantFn of invariants) {
        const detected = invariantFn(record);
        for (const violation of detected) {
          rawViolations.push(violation);
          violationsByInvariant[violation.invariant] =
            (violationsByInvariant[violation.invariant] ?? 0) + 1;
          violationsBySeverity[violation.severity] =
            (violationsBySeverity[violation.severity] ?? 0) + 1;
        }
      }
    }
  };

  for await (const record of resolved as AsyncIterable<SwapRecord>) {
    if (totalScanned >= maxRecords) {
      isBoundedLimitReached = true;
      break;
    }

    currentChunk.push(record);
    totalScanned++;

    if (currentChunk.length >= chunkSize) {
      processChunk(currentChunk);
      currentChunk = [];
    }
  }

  if (currentChunk.length > 0) {
    processChunk(currentChunk);
  }

  const completedAt = options?.now ?? Date.now();
  const violations = sortViolationsDeterministically(rawViolations);
  const offendingSwapIds = new Set(violations.map((v) => v.swapId));
  const driftRate =
    totalScanned > 0 ? offendingSwapIds.size / totalScanned : 0;

  return {
    jobId,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    totalScanned,
    chunksProcessed,
    isBoundedLimitReached,
    violationCount: violations.length,
    violationsByInvariant,
    violationsBySeverity,
    violations,
    summary: {
      consistent: violations.length === 0,
      totalRecords: totalScanned,
      driftRate: Math.round(driftRate * 10_000) / 10_000,
    },
  };
}
