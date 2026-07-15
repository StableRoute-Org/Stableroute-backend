# Request validation

StableRoute backend validates inbound payloads inline at route handlers.
Pair metadata PATCH routes share a descriptor table in `src/index.ts` that
centralizes field names, validators, and cross-field checks:

| Route suffix | Field | Validator summary |
|--------------|-------|-------------------|
| `liquidity` | `liquidity` | Non-negative integer string (≤39 digits) |
| `max` | `maxAmount` | Positive integer string |
| `min` | `minAmount` | Non-negative integer string; must be ≤ max/liquidity |
| `fee_bps` | `feeBps` | Integer in `[0, 1000]` |
| `rate` | `rate` | Positive decimal string, max 8 fractional digits |

Webhook registration validates:

- `url` must be `http(s)` with length ≤ 2048 and pass SSRF checks (`isSafeWebhookUrl`)
- `events` must be a non-empty string array with deduplicated entries

Unknown JSON keys on mutating routes are rejected via `rejectUnknownKeys`.

See OpenAPI (`openapi.yaml`) for the public contract and error envelope shape.
