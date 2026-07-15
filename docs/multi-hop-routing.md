# Multi-hop route discovery

StableRoute discovers indirect paths when no direct pair exists between
source and destination assets. The engine walks the registered pair graph
to find feasible hops while respecting per-pair fees and liquidity ceilings.

Operational notes:

1. Register intermediate pairs before expecting multi-hop quotes.
2. Each hop applies its own `feeBps` and amount bounds.
3. Failed discovery returns `404 not_found` rather than a partial quote.

Implementation lives in the quote handler within `src/index.ts`; extend
`docs/pricing.md` when changing hop selection heuristics.
