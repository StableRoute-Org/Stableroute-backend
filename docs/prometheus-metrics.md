# Prometheus metrics

`GET /api/v1/metrics` exposes text/0.0.4 gauges for:

- `stableroute_pairs_total`, `stableroute_paused`
- `stableroute_events_total`, `stableroute_events_by_type{type="…"}`
- Store sizes: API keys, webhooks, event log
- `stableroute_rate_limit_per_window`

Event-type labels are bounded to the known catalog to keep scrape cardinality stable.
See `src/__tests__/index.test.ts` metrics section for regression tests.

Future work: request counters and latency histograms (issue #11).
