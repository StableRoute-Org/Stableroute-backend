# StableRoute — Quote & Pricing Concepts Guide

This guide explains how the quote engine converts an input amount into a
quoted output, covering every concept you need to understand or extend
the pricing surface in [`src/index.ts`](../src/index.ts).

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

---

## 2. Basis-point fees

Fees are expressed in **basis points** (bps), where **1 bp = 0.01%**
(i.e. 1 / 10 000). The API accepts any integer in `[0, 1000]`
(0% – 10%).

### Fee formula

```
fee_amount   = floor( amount × feeBps / 10 000 )
net_amount   = amount − fee_amount
```

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

> **Current status — placeholder:** the `POST /api/v1/quote` and
> `GET /api/v1/quote` handlers return the pair's configured `estimated_rate` and do
> **not** deduct a fee from the quoted amount yet. The `feeBps` field is
> stored per-pair via `PATCH /api/v1/pairs/:source/:destination/fee_bps`
> and will be applied once the rate oracle lands. The formula above is
> the intended contract.

> Pair-level base rates can now be configured with
> `PATCH /api/v1/pairs/:source/:destination/rate`; newly registered pairs keep
> the `"1.0"` default until configured.

---

## 3. Exchange rate

The quote endpoint returns the pair's configured base rate, defaulting to
`"1.0"` for newly registered pairs:

```json
{
  "source_asset": "USDC",
  "dest_asset":   "EURC",
  "amount":       "1000000",
  "estimated_rate": "1.0",
  "route":        ["USDC", "EURC"]
}
```

`estimated_rate` is a positive decimal string representing **dest units per
source unit**. When destination amount conversion is integrated, it will be:

```
dest_amount = floor( net_amount × rate )
```

> **Contractually stable today:** the response shape (`source_asset`,
> `dest_asset`, `amount`, `estimated_rate`, `route`), the `parseAmount`
> validation rules, and the `feeBps` range `[0, 1000]`. These will not
> change without a versioned API bump.

---

## 4. Min / max / liquidity bounds

Each registered pair can carry three optional bounds stored in
`PairMeta`:

| Field       | Default | Meaning |
|-------------|---------|---------|
| `minAmount` | `"0"`   | Smallest accepted source amount (base units). Requests below this floor are rejected. |
| `maxAmount` | `"0"`   | Largest accepted source amount (base units). `"0"` means uncapped. |
| `liquidity` | `"0"`   | Available liquidity in the pool (base units). A quote whose `net_amount` exceeds `liquidity` is rejected. |

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
amount     = "250000000000"
feeBps     = 50      (0.50 %)
fee_amount = floor( 250000000000 × 50 / 10000 ) = 1250000000
net_amount = 250000000000 − 1250000000 = 248750000000

liquidity  = 200000000000
248750000000 > 200000000000   →   REJECTED (insufficient liquidity)
```

**Case D — valid quote:**
```
amount     = "150000000000"
feeBps     = 50
fee_amount = floor( 150000000000 × 50 / 10000 ) = 750000000
net_amount = 150000000000 − 750000000 = 149250000000

minAmount check: 150000000000 >= 1000000   ✓
maxAmount check: 150000000000 <= 500000000000   ✓
liquidity check: 149250000000 <= 200000000000   ✓   →   ACCEPTED
```

> **Current status — placeholder:** bounds enforcement is not yet wired
> into the quote handler. The bounds are stored and returned by the pair
> info endpoint but are not validated at quote time. Enforcement will be
> added alongside the fee deduction step.

---

## 5. Asset code validation

Asset codes are validated with `isAssetCode`:

```typescript
const isAssetCode = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 12;
```

This mirrors Stellar's 1–12 character alphanumeric asset code limit.
`source_asset` and `dest_asset` must differ; same-asset quotes are
rejected with `400 invalid_request`.

---

## 6. Quick reference

| Concept | Rule |
|---------|------|
| Amount encoding | Positive integer string, no leading zeros, max 39 digits |
| Fee range | Integer basis points in `[0, 1000]` (0 – 10 %) |
| Fee formula | `floor(amount × feeBps / 10000)` |
| Rate (current) | Flat `"1.0"` placeholder |
| Asset code | 1–12 chars, source ≠ destination |
| Min/max/liquidity | Stored per-pair; enforcement pending rate oracle |

---

*See [api.md](api.md) for the full HTTP endpoint reference and `curl` examples.*
