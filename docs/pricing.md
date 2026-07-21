# StableRoute — Quote & Pricing Concepts Guide

This guide explains how the quote engine converts an input amount into a
quoted output, and documents the pure pricing module in
[`src/pricing.ts`](../src/pricing.ts) that backs all three quote endpoints:
`GET /api/v1/quote`, `GET /api/v1/quote/reverse`, and `POST /api/v1/quote/bulk`
(all defined in [`src/index.ts`](../src/index.ts)).

---

## 0. The pricing module

`src/pricing.ts` has **no dependency on Express, the in-memory stores, or any
other runtime state** — every export takes plain values (`bigint`, `number`,
`PairMeta`) and returns plain values. This is what lets the module be unit
tested directly (see [`src/__tests__/pricing.test.ts`](../src/__tests__/pricing.test.ts))
instead of only being exercised indirectly through HTTP-level tests, and lets
the three quote handlers share one implementation instead of duplicating the
same arithmetic three times.

| Export | Signature | Purpose |
|--------|-----------|---------|
| `applyFee` | `(amount: bigint, feeBps: number) => { feeAmount, netAmount }` | Deducts the pair's fee from a gross amount. |
| `applySlippage` | `(amount: bigint, slippageBps: number) => bigint` | Applies slippage tolerance to a net amount. |
| `checkQuoteBounds` | `(meta: PairMeta, amount: bigint) => QuoteBoundsViolation \| null` | Validates an amount against the pair's min/max/liquidity bounds. |
| `solveInput` | `(target: bigint) => bigint` | Solves for the required source input given a target destination amount. |
| `priceQuote` | `(meta: PairMeta, amount: bigint, slippageBps: number) => PricedQuote` | Forward-quote pricing: fee + slippage, composed from `applyFee`/`applySlippage`. |
| `priceReverseQuote` | `(meta: PairMeta, targetAmount: bigint) => PricedReverseQuote` | Reverse-quote pricing, composed from `solveInput`. |

`checkQuoteBounds` is called separately from `priceQuote`/`priceReverseQuote`
because a bounds violation needs to short-circuit the handler with its own
HTTP status (`400` or `422`) before any pricing math runs.

---

## 1. Base-units and `BigInt`

All amounts in the API are **base-units integer strings** — the smallest
indivisible denomination of the asset (e.g. stroops for XLM, micro-USDC
for USDC). Strings are used instead of JSON numbers because JavaScript's
`Number` type loses precision above `Number.MAX_SAFE_INTEGER`
(2^53 − 1 = 9 007 199 254 740 991). A single large USDC transfer can
easily exceed this boundary:

```
10 000 000 USDC  ×  1 000 000 micro-USDC/USDC
= 10 000 000 000 000 micro-USDC   (10^13 — within safe range)

100 000 000 000 USDC  ×  1 000 000
= 100 000 000 000 000 000 000     (10^20 — above MAX_SAFE_INTEGER)
```

Parsing is done via `BigInt(v)` after a regex pre-check:

```typescript
// src/index.ts — parseAmount
const parseAmount = (v: unknown): bigint | null => {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,38}$/.test(v)) return null;
  try {
    const n = BigInt(v);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
};
```

**Rules enforced by the regex:**

| Rule | Detail |
|------|--------|
| No leading zeros | `"007"` → rejected (`/^[1-9]/`) |
| Positive only | `"0"` → rejected by the `> 0n` guard |
| Max 39 digits | Covers amounts up to 10^39 − 1 base units |
| String type required | `123` (number) → rejected |

All downstream pricing math in `src/pricing.ts` operates on the resulting
`bigint`, so amounts never pass through `Number` and never lose precision.

---

## 2. Basis-point fees

Fees are expressed in **basis points** (bps), where **1 bp = 0.01%**
(i.e. 1 / 10 000). The API accepts any integer in `[0, 1000]`
(0% – 10%), stored per-pair as `PairMeta.feeBps`.

### Fee formula — `applyFee`

```typescript
// src/pricing.ts
export const applyFee = (amount: bigint, feeBps: number): FeeBreakdown => {
  const feeAmount = (amount * BigInt(feeBps)) / 10_000n;
  const netAmount = amount - feeAmount;
  return { feeAmount, netAmount };
};
```

```
fee_amount   = floor( amount × feeBps / 10 000 )
net_amount   = amount − fee_amount
```

The fee is always rounded **down** (in the gateway's favour) via BigInt
integer division.

### Worked example — fee applied to a large transfer

**Inputs:**
- `amount`  = `"18446744073709551615"` (2^64 − 1, a typical u64 maximum)
- `feeBps`  = `30` (0.30 %)

**Calculation (BigInt arithmetic):**

```
fee_amount = floor( 18446744073709551615 × 30 / 10000 )
           = floor( 553402322211286548450 / 10000 )
           = floor( 55340232221128654.845 )
           = 55340232221128654

net_amount = 18446744073709551615 − 55340232221128654
           = 18391403841488422961
```

Using `Number` instead of `BigInt` would silently corrupt both values
(the intermediate product `553402322211286548450` is far above
`Number.MAX_SAFE_INTEGER`), which is exactly why `BigInt` is required.

---

## 3. Slippage tolerance

`GET /api/v1/quote` accepts an optional `slippage_bps` query parameter
(`[0, 1000]`, default `0`); `POST /api/v1/quote/bulk` currently applies a
fixed `slippage_bps: 0` per item. Slippage is applied to the **net** amount
(after the fee has already been deducted):

```typescript
// src/pricing.ts
export const applySlippage = (amount: bigint, slippageBps: number): bigint => {
  const slippageAmount = (amount * BigInt(slippageBps)) / 10_000n;
  return amount - slippageAmount;
};
```

```
min_received = net_amount − floor( net_amount × slippageBps / 10 000 )
```

### `priceQuote` — composing fee + slippage

`GET /api/v1/quote` and `POST /api/v1/quote/bulk` both call `priceQuote`,
which chains `applyFee` into `applySlippage` and echoes the pair's `feeBps`
and `rate`:

```typescript
// src/pricing.ts
export const priceQuote = (meta: PairMeta, amount: bigint, slippageBps: number): PricedQuote => {
  const { feeAmount, netAmount } = applyFee(amount, meta.feeBps);
  const minReceived = applySlippage(netAmount, slippageBps);
  return { feeBps: meta.feeBps, feeAmount, netAmount, minReceived, rate: meta.rate };
};
```

**Worked example:**

```
amount       = 10_000
feeBps       = 100   (1 %)
slippage_bps = 200   (2 %)

fee_amount   = floor(10_000 × 100 / 10_000) = 100
net_amount   = 10_000 − 100 = 9_900

slippage_amt = floor(9_900 × 200 / 10_000) = 198
min_received = 9_900 − 198 = 9_702
```

---

## 4. Exchange rate

The quote endpoints return the pair's stored `rate` (default `"1.0"`)
verbatim as `estimated_rate`; no destination-amount conversion is performed
by `priceQuote` today. `priceReverseQuote` behaves the same way on the
reverse-quote path.

```json
{
  "source_asset": "USDC",
  "dest_asset":   "EURC",
  "amount":       "1000000",
  "estimated_rate": "1.0",
  "route":        ["USDC", "EURC"]
}
```

> **Contractually stable today:** the response shape (`source_asset`,
> `dest_asset`, `amount`, `estimated_rate`, `route`), the `parseAmount`
> validation rules, and the `feeBps` range `[0, 1000]`. These will not
> change without a versioned API bump.

---

## 5. Min / max / liquidity bounds — `checkQuoteBounds`

Each registered pair can carry three optional bounds stored in
`PairMeta`:

| Field       | Default | Meaning |
|-------------|---------|---------|
| `minAmount` | `"0"`   | Smallest accepted source amount (base units). Requests below this floor are rejected. |
| `maxAmount` | `"0"`   | Largest accepted source amount (base units). `"0"` means uncapped. |
| `liquidity` | `"0"`   | Available liquidity in the pool (base units). A quote whose requested amount exceeds `liquidity` is rejected. |

A value of `"0"` means the bound is unset and is skipped. `checkQuoteBounds`
checks `minAmount`, then `maxAmount`, then `liquidity`, in that order, and
returns on the first violation it finds:

```typescript
// src/pricing.ts
export const checkQuoteBounds = (meta: PairMeta, amount: bigint): QuoteBoundsViolation | null => {
  // minAmount -> 400 invalid_request
  // maxAmount -> 400 invalid_request
  // liquidity -> 422 insufficient_liquidity
  // otherwise -> null
};
```

All three quote handlers call `checkQuoteBounds` against the *requested*
amount before pricing it, and short-circuit with the violation's `status`/
`error` (single quotes) or `bulkError` (bulk quotes) if it returns non-null.

### Worked example — bounds rejection

**Pair config:**
- `minAmount` = `"1000000"` (1 USDC at 6 decimal places)
- `maxAmount` = `"500000000000"` (500 000 USDC)
- `liquidity` = `"200000000000"` (200 000 USDC)

**Case A — below minimum:**
```
amount = "999999"   →   999999 < 1000000   →   REJECTED (below minAmount)
```

**Case B — above maximum:**
```
amount = "600000000000"   →   600000000000 > 500000000000   →   REJECTED (above maxAmount)
```

**Case C — exceeds available liquidity:**
```
amount = "250000000000"   →   250000000000 > 200000000000   →   REJECTED (insufficient liquidity)
```

**Case D — valid quote:**
```
amount = "150000000000"

minAmount check: 150000000000 >= 1000000        ✓
maxAmount check: 150000000000 <= 500000000000   ✓
liquidity check: 150000000000 <= 200000000000   ✓   →   ACCEPTED

feeBps = 50 (0.50 %)
fee_amount = floor(150000000000 × 50 / 10000) = 750000000
net_amount = 150000000000 − 750000000 = 149250000000
```

---

## 6. Reverse quotes — `priceReverseQuote` / `solveInput`

`GET /api/v1/quote/reverse` takes a `target_amount` (desired destination
amount) and solves for the required source input via `priceReverseQuote`,
which wraps `solveInput`:

```typescript
// src/pricing.ts
export const solveInput = (target: bigint): bigint => {
  return target;
};
```

Currently `solveInput` is a 1:1 identity mapping (`required_input ==
target_amount`), but it is structured so rates, fees, or other adjustments
can be layered in later without changing the handler or its callers.

---

## 7. Asset code validation

Asset codes are validated with `normalizeAsset` in `src/index.ts`, which
trims, upper-cases, and checks against `/^[A-Z0-9]{1,12}$/` — mirroring
Stellar's 1–12 character alphanumeric asset code limit. `source_asset` and
`dest_asset` must differ; same-asset quotes are rejected with
`400 invalid_request`.

---

## 8. Quick reference

| Concept | Rule |
|---------|------|
| Amount encoding | Positive integer string, no leading zeros, max 39 digits |
| Fee range | Integer basis points in `[0, 1000]` (0 – 10 %) |
| Fee formula | `floor(amount × feeBps / 10000)` |
| Slippage formula | `floor(net_amount × slippageBps / 10000)` subtracted from `net_amount` |
| Rate | Pair's stored `rate` string, echoed verbatim as `estimated_rate` |
| Asset code | 1–12 chars, source ≠ destination |
| Min/max/liquidity | Stored per-pair; enforced at quote time via `checkQuoteBounds` |
| Pure pricing module | [`src/pricing.ts`](../src/pricing.ts) — no Express/store dependency, unit tested in [`src/__tests__/pricing.test.ts`](../src/__tests__/pricing.test.ts) |

---

*See [api.md](api.md) for the full HTTP endpoint reference and `curl` examples,
and [quote-bounds.md](quote-bounds.md) / [fee-bps.md](fee-bps.md) for more on
the underlying `PairMeta` fields.*
