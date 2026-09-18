# Price Oracle Resilience & Circuit Breaker Architecture

StableRoute interacts with external price oracles and upstream services to resolve live exchange rates and asset pricing. To protect the gateway and downstream clients from cascading outages, thundering herds, and upstream latency spikes, all external price oracle interactions are governed by a resilient execution pipeline combining **bounded exponential backoff with full jitter** and an **isolated per-dependency circuit breaker**.

---

## State Machine: Circuit Breaker

Each external dependency is guarded by a standard three-state finite state machine:

```
          failure threshold exceeded (consecutive failures >= N)
  CLOSED ──────────────────────────────────────────────────────────> OPEN
    ▲                                                                 │
    │ probe success                                cooldown elapsed   │
    │                                                                 │
    │                                                                 ▼
  HALF_OPEN <─────────────────────────────────────────────────────────┘
    │
    │ probe failure
    └───────────────────────────────────────────────────────────────> OPEN
```

### State Definitions

1. **`CLOSED` (Normal Operation)**:
   - Requests are forwarded directly to the upstream dependency through the retry pipeline.
   - Any successful call resets the consecutive failure counter to `0`.
   - If consecutive failures reach or exceed `failureThreshold` (default `5`), the breaker transitions to `OPEN`.

2. **`OPEN` (Fail-Fast Outage Protection)**:
   - All inbound requests immediately fail fast without executing any network calls or burdening the failing upstream dependency.
   - Throws a typed `CircuitBreakerOpenError` mapped to HTTP `503 upstream_unavailable`.
   - Each fast-fail rejection increments the `totalShortCircuits` counter.
   - Once `cooldownMs` (default `30,000` ms) has elapsed since the last failure, the breaker transitions to `HALF_OPEN`.

3. **`HALF_OPEN` (Canary / Health Probe)**:
   - The breaker admits a limited probe budget (`halfOpenMaxCalls`, default `1`) to test upstream recovery.
   - Concurrent calls during an active probe fail fast immediately.
   - If the probe call succeeds:
     - The circuit transitions back to `CLOSED`.
     - Consecutive failure counts are reset to `0`.
   - If the probe call fails:
     - The circuit immediately re-opens (`OPEN`) and restarts the cooldown timer.

---

## Retry Pipeline: Exponential Backoff with Full Jitter

Transient errors are retried according to an exponential backoff curve with full jitter to avoid synchronous retry stampedes (thundering herds):

$$\text{delay} = \text{random}(0, \, \min(\text{baseDelayMs} \cdot 2^{\text{attempt} - 1}, \, \text{maxDelayMs}))$$

### Configurable Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `oracleRetryAttempts` | `3` | Maximum execution attempts (initial try + 2 retries). Strictly bounded. |
| `oracleBackoffBaseMs` | `100` | Base exponential backoff delay in milliseconds. |
| `oracleBreakerThreshold` | `5` | Consecutive failures before opening the circuit breaker. |
| `oracleBreakerCooldownMs` | `30,000` | Cooldown period (ms) before an `OPEN` breaker enters `HALF_OPEN`. |

All four parameters can be inspected and tuned dynamically at runtime via `PATCH /api/v1/config`.

---

## Error Classification & Idempotency

### Transient vs Non-Retryable Errors

To minimize latency and prevent redundant traffic, only transient failures are retried:

- **Retryable (Transient)**:
  - Network disconnection or reset (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EPIPE`).
  - HTTP 5xx server responses (`500`, `502`, `503`, `504`).
  - HTTP 429 rate limit exceeded.
- **Non-Retryable (Permanent)**:
  - HTTP 4xx client errors (`400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `422 Unprocessable`).
  - Validation failures, schema rejections, syntax errors.
  - Non-retryable errors abort immediately on attempt 1 without sleeping or retrying.

### Idempotency Protection

Non-idempotent operations (`isIdempotent: false`) are **never** retried on failure, even for transient 500 errors, guaranteeing no duplicated side effects occur against upstream services.

---

## Per-Dependency Isolation

Circuit breakers are tracked per named dependency via `circuitBreakerRegistry`:

- An outage in `price-oracle` will trip only the `price-oracle` breaker.
- Sibling dependencies (e.g. `stellar-horizon`, `soroban-rpc`) remain in the healthy `CLOSED` state and continue serving traffic.
- State is never shared globally across distinct upstream providers.

---

## HTTP Endpoints & Observability

### 1. `GET /api/v1/oracle/status`

Inspect circuit breaker states and health metrics across registered upstream dependencies.

#### Query Parameters
- `dependency` *(optional)*: Filter by named dependency (e.g. `price-oracle`).

#### Example Response
```json
{
  "breakers": [
    {
      "name": "price-oracle",
      "state": "CLOSED",
      "consecutiveFailures": 0,
      "totalFailures": 0,
      "totalSuccesses": 42,
      "totalShortCircuits": 0,
      "lastFailureTime": null,
      "lastStateChange": 1726634000000
    }
  ]
}
```

### 2. `GET /api/v1/oracle/rate/:source/:destination`

Fetch current exchange rate between two assets. Protected by retry with backoff and upstream circuit breaker.

- **200 OK**: Rate resolved successfully.
  ```json
  {
    "source": "USDC",
    "destination": "XLM",
    "rate": "8.50",
    "timestamp": 1726634000123
  }
  ```
- **400 Bad Request**: Invalid asset symbol or source equals destination.
- **503 Upstream Unavailable**: Circuit breaker is `OPEN`. Call failed fast without hitting the upstream provider.
  ```json
  {
    "code": "upstream_unavailable",
    "message": "circuit breaker for 'price-oracle' is OPEN (fail-fast)"
  }
  ```

### 3. Prometheus Metrics (`GET /api/v1/metrics`)

Exposes standard Prometheus metrics:

```prometheus
# HELP stableroute_circuit_breaker_state Current state of circuit breaker (0=CLOSED, 1=HALF_OPEN, 2=OPEN).
# TYPE stableroute_circuit_breaker_state gauge
stableroute_circuit_breaker_state{dependency="price-oracle"} 0

# HELP stableroute_circuit_breaker_failures_total Total failure count recorded by circuit breaker.
# TYPE stableroute_circuit_breaker_failures_total counter
stableroute_circuit_breaker_failures_total{dependency="price-oracle"} 0

# HELP stableroute_circuit_breaker_successes_total Total success count recorded by circuit breaker.
# TYPE stableroute_circuit_breaker_successes_total counter
stableroute_circuit_breaker_successes_total{dependency="price-oracle"} 42

# HELP stableroute_circuit_breaker_short_circuits_total Total fast-fail rejections when circuit breaker is OPEN.
# TYPE stableroute_circuit_breaker_short_circuits_total counter
stableroute_circuit_breaker_short_circuits_total{dependency="price-oracle"} 0
```
