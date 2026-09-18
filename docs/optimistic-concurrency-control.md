# Optimistic Concurrency Control (OCC) for Route Updates

This document describes the design, implementation, error taxonomy, and client retry patterns for Optimistic Concurrency Control (OCC) across all route metadata update endpoints in StableRoute backend (Issue #549).

---

## 1. Overview & Motivation

When multiple administrators or automated market-making bots concurrently update route parameters (e.g., adjusting `fee_bps`, `liquidity`, `min`, `max`, `rate`, or toggling `enabled`), race conditions and lost updates can occur if updates blindly overwrite state.

To prevent lost updates and guarantee deterministic, sequential mutations, StableRoute implements **Optimistic Concurrency Control (OCC)**:

- Every route (`PairMeta`) maintains an integer `version` field starting at `1` and monotonically incrementing on every mutation.
- All mutating endpoints require callers to declare their expected base version.
- Compare-and-set (CAS) is executed atomically at the store layer.
- If the current store version differs from the expected version, the update is rejected with `409 version_conflict`, providing the fresh `currentVersion` so the client can re-read and retry safely.

---

## 2. Route Model Versioning

The `PairMeta` structure stored in `pairMeta` contains:

```typescript
export type PairMeta = {
  feeBps: number;
  minAmount: string;
  maxAmount: string;
  liquidity: string;
  enabled: boolean;
  rate: string;
  /** Monotonically increasing version counter for optimistic concurrency control. */
  version: number;
};
```

- Initial routes default to `version: 1`.
- Snapshots and migrations backfill `version = 1` for legacy entries.
- Every successful update atomically increments `version` by `1`.

---

## 3. Store-Level Atomic Compare-and-Set (CAS)

CAS is enforced directly inside `src/stores.ts` via `updatePairMetaCas`:

```typescript
export function updatePairMetaCas(
  key: string,
  expectedVersion: number,
  updater:
    | Partial<Omit<PairMeta, "version">>
    | ((current: PairMeta) => { updates?: Partial<Omit<PairMeta, "version">>; error?: string } | null),
): PairMetaCasResult
```

### Guarantees:
1. **Atomic Evaluation**: Reads the current store value and checks `current.version === expectedVersion`.
2. **Atomic Increment**: If versions match, calculates new state and assigns `version: current.version + 1` in a single synchronous operation.
3. **Pluggable Storage Support**: The `StorageAdapter` interface defines `metaCas(key, expectedVersion, update)` supported by both `InMemoryAdapter` and `JsonFileAdapter`.

---

## 4. HTTP API Contract

### Providing Expected Version
Callers can specify the expected version using any of the following (in precedence order):
1. Request body: `version: <integer>`
2. Request body alias: `expected_version: <integer>`
3. HTTP Header: `If-Match: "<integer>"` or `If-Match: W/"<integer>"`

If the version is omitted, null, empty string, negative, or not an integer, the server responds with `400 invalid_request`.

### Endpoints Under OCC Protection
- `PATCH /api/v1/pairs/:source/:destination/liquidity`
- `PATCH /api/v1/pairs/:source/:destination/max`
- `PATCH /api/v1/pairs/:source/:destination/min`
- `PATCH /api/v1/pairs/:source/:destination/fee_bps`
- `PATCH /api/v1/pairs/:source/:destination/rate`
- `PATCH /api/v1/pairs/:source/:destination/enabled`
- `POST /api/v1/pairs/:source/:destination/reset` (when version supplied)

### Read Endpoints Exposing Version & ETag
- `GET /api/v1/pairs/:source/:destination/info`
  - Body: `{ source, destination, feeBps, minAmount, maxAmount, liquidity, enabled, rate, version }`
  - Header: `ETag: "<version>"`
- `GET /api/v1/pairs/:source/:destination`
  - Body: `{ source, destination, registered: true, version }`
  - Header: `ETag: "<version>"`

---

## 5. Error Taxonomy & Response Formats

### 409 Conflict (`version_conflict`)
Returned when the resource has been modified since the caller last read it:

```json
{
  "error": "version_conflict",
  "message": "version conflict: expected version 1, current version is 2",
  "currentVersion": 2,
  "expectedVersion": 1,
  "requestId": "req-12345"
}
```

### 400 Bad Request (`invalid_request`)
Returned when the version is missing or invalid:
- Missing: `"version is required"`
- Non-integer or negative: `"version must be a non-negative integer"`

---

## 6. Edge Cases Covered

1. **Two updates from same base version**:
   Client A and Client B both send update with `version: 1`. Client A's request lands first, advancing the route to `version: 2`. Client B's request receives `409 version_conflict` with `currentVersion: 2`.
2. **Sequential updates bumping version**:
   Client updates `fee_bps` (v1 -> v2), then `liquidity` (v2 -> v3), then `rate` (v3 -> v4). All succeed sequentially.
3. **Missing or invalid version**:
   Omitted version, `null`, `""`, negative numbers (`-1`), floats (`1.5`), or strings (`"one"`) return `400 invalid_request`.
4. **Future version**:
   Caller provides `version: 99` when current is `1`. Rejected with `409 version_conflict` with `currentVersion: 1`.
5. **Read always exposes current version**:
   Reads (`GET /info` and `GET /:source/:destination`) immediately reflect updated versions and emit corresponding `ETag` headers.
6. **Concurrent races**:
   When $N$ simultaneous requests attempt to update from the same base version using `Promise.all`, exactly 1 request succeeds (200), and all remaining $N-1$ requests fail with 409 conflict.

---

## 7. Recommended Client Retry Pattern

```typescript
async function updateRouteWithRetry(
  source: string,
  destination: string,
  field: string,
  value: unknown,
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 1. Fetch latest route metadata
    const infoRes = await fetch(`/api/v1/pairs/${source}/${destination}/info`);
    const info = await infoRes.json();
    const currentVersion = info.version;

    // 2. Attempt update with expected version
    const updateRes = await fetch(`/api/v1/pairs/${source}/${destination}/${field}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value, version: currentVersion }),
    });

    if (updateRes.status === 200) {
      return await updateRes.json();
    }

    if (updateRes.status === 409) {
      const err = await updateRes.json();
      console.warn(`Version conflict on attempt ${attempt + 1}, retrying with current version ${err.currentVersion}`);
      continue;
    }

    throw new Error(`Failed to update route: ${updateRes.statusText}`);
  }
  throw new Error("Exceeded max retries updating route");
}
```
