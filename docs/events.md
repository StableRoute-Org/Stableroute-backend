# StableRoute Backend — Events & Webhook Payload Reference

This document describes the audit-event machinery in `src/stores.ts` and
`src/index.ts`: the `AppEvent` envelope, every emitted event type with its
`payload` fields, the `GET /api/v1/events` query contract, and the webhook
subscription model.

---

## AppEvent envelope

Every event written by `recordEvent` shares the same top-level shape:

```ts
type AppEvent = {
  id: string;               // UUID v4, unique per event
  ts: number;               // Unix epoch milliseconds (Date.now())
  type: string;             // Dot-separated event name (see taxonomy below)
  payload: Record<string, unknown>; // Event-specific fields (no secrets)
};
```

**Security note:** `payload` values are derived from validated request bodies
and never include raw API keys, webhook secrets, or any other credential. All
key material is discarded before `recordEvent` is called.

---

## Event taxonomy

The table below lists every event type that the backend currently emits, the
`recordEvent` call site in `src/index.ts`, and the fields present in its
`payload`.

| Event type          | Emitted when                                  | `payload` fields                   |
|---------------------|-----------------------------------------------|------------------------------------|
| `pair.registered`   | `POST /api/v1/pairs` creates a new pair       | `source`, `destination`            |
| `pair.refreshed`    | `POST /api/v1/pairs` re-registers an existing pair | `source`, `destination`       |
| `pair.unregistered` | `DELETE /api/v1/pairs/:source/:destination`   | `source`, `destination`            |

### pair.registered

Emitted the first time a `(source, destination)` pair is registered.

| Field         | Type   | Description                              |
|---------------|--------|------------------------------------------|
| `source`      | string | Source asset code (e.g. `"USDC"`)        |
| `destination` | string | Destination asset code (e.g. `"EURC"`)   |

**Example:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "ts": 1700000000000,
  "type": "pair.registered",
  "payload": {
    "source": "USDC",
    "destination": "EURC"
  }
}
```

### pair.refreshed

Emitted when `POST /api/v1/pairs` is called for a pair that is already
registered (idempotent re-write). The pair record is unchanged but the event
provides an audit trail of the duplicate registration attempt.

| Field         | Type   | Description                              |
|---------------|--------|------------------------------------------|
| `source`      | string | Source asset code                        |
| `destination` | string | Destination asset code                   |

### pair.unregistered

Emitted when a pair is deleted via `DELETE /api/v1/pairs/:source/:destination`.

| Field         | Type   | Description                              |
|---------------|--------|------------------------------------------|
| `source`      | string | Source asset code (e.g. `"USDC"`)        |
| `destination` | string | Destination asset code (e.g. `"XLM"`)    |

**Example:**

```json
{
  "id": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "ts": 1700001000000,
  "type": "pair.unregistered",
  "payload": {
    "source": "USDC",
    "destination": "XLM"
  }
}
```

---

## GET /api/v1/events

Returns a slice of the in-memory event log (capped at 10 000 entries; oldest
events are evicted when the cap is reached).

### Query parameters

| Parameter | Type   | Default | Description                                                          |
|-----------|--------|---------|----------------------------------------------------------------------|
| `since`   | number | `0`     | Return only events whose `ts` is ≥ this value (Unix epoch ms).       |
| `limit`   | number | `100`   | Maximum number of events to return. Clamped to `[1, 10000]`.         |

### Response

```json
{
  "items": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "ts": 1700000000000,
      "type": "pair.registered",
      "payload": { "source": "USDC", "destination": "EURC" }
    }
  ]
}
```

`items` is ordered oldest-first within the matching window and contains at
most `limit` entries.

---

## Webhook subscriptions

### Registering a webhook

`POST /api/v1/webhooks` registers an endpoint that will receive event
deliveries. Body:

```json
{
  "url": "https://example.com/webhooks/stableroute",
  "events": ["pair.registered", "pair.unregistered"]
}
```

| Field    | Type     | Constraints                                            |
|----------|----------|--------------------------------------------------------|
| `url`    | string   | Must begin with `http://` or `https://`; ≤ 2048 chars  |
| `events` | string[] | Non-empty array of event-type strings to subscribe to  |

A successful `201` response includes the generated webhook `id`:

```json
{
  "id": "wh_abcdef1234567890",
  "url": "https://example.com/webhooks/stableroute",
  "events": ["pair.registered", "pair.unregistered"]
}
```

### Delivered payload shape

When an event matching a subscription's `events` list is emitted, the backend
delivers a POST request to the registered `url`. The body is the `AppEvent`
envelope unchanged:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "ts": 1700000000000,
  "type": "pair.registered",
  "payload": {
    "source": "USDC",
    "destination": "EURC"
  }
}
```

**Security guarantee:** delivered payloads never contain raw API keys,
signing secrets, or any other credential. All sensitive values are stripped
before the event is recorded and before delivery.

### Managing webhooks

| Method   | Path                       | Description                        |
|----------|----------------------------|------------------------------------|
| `GET`    | `/api/v1/webhooks`         | List all registered webhooks        |
| `POST`   | `/api/v1/webhooks`         | Register a new webhook              |
| `DELETE` | `/api/v1/webhooks/:id`     | Remove a webhook by id              |

---

## Cross-reference: recordEvent call sites

The following table maps each `recordEvent` call in `src/index.ts` to its
documented event type so contributors can verify consistency:

| File location (src/index.ts) | Event type          |
|------------------------------|---------------------|
| `POST /api/v1/pairs` — new pair | `pair.registered` |
| `POST /api/v1/pairs` — existing pair | `pair.refreshed` |
| `DELETE /api/v1/pairs/:source/:destination` | `pair.unregistered` |
