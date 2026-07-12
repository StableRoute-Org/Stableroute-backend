# Per-pair fee (fee_bps)

Quotes apply each pair's stored `feeBps` when computing output:

```
fee_amount = floor(amount × feeBps / 10_000)
quoted_out = amount − fee_amount   (simplified; see pricing.md)
```

Configure via `PATCH /api/v1/pairs/:source/:destination/fee_bps` with an
integer in `[0, 1000]`. Validation rules and worked examples live in
[`docs/pricing.md`](./pricing.md).
