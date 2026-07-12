# Quote amount bounds

The routing engine rejects quotes outside configured pair metadata bounds:

- `minAmount` — smallest accepted input (integer string, base units)
- `maxAmount` — largest accepted input
- `liquidity` — ceiling based on available pool liquidity

Cross-field checks ensure `minAmount ≤ maxAmount ≤ liquidity`. Invalid
combinations return `400 invalid_request` with the canonical error envelope.

See pair PATCH validators in `src/index.ts` and `docs/validation.md`.
