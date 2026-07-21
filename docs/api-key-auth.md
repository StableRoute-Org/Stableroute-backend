# API key authentication

Write routes (`POST /api/v1/pairs`, webhook registration, admin pause
controls, API key administration itself) require a valid API key in the
`Authorization: Bearer <key>` header, scoped via `requireScope` in
[`src/index.ts`](../src/index.ts) against one of the scopes in
`SCOPE_CATALOG` (`pairs:write`, `webhooks:write`, `keys:admin`).

## Storage model: salted hashes, never the raw key

`apiKeyStore` (in [`src/stores.ts`](../src/stores.ts)) never retains
recoverable key material — not as the record's contents, and not as the
map's lookup key. For each key:

- **`apiKeyStore` is keyed by the key's 8-character `prefix`** (see
  `apiKeyPrefix`), not by the raw key. The prefix is the same non-secret
  handle already returned by `POST`/`GET`/`DELETE`/`rotate` — it identifies
  a key for display and admin operations but cannot be used to authenticate.
- **The record stores only `salt` and `hash`**, never the raw key:
  - `salt` — a fresh random 16-byte value (hex-encoded) generated per key
    via `generateApiKeySalt`.
  - `hash` — `HMAC-SHA256(key = salt, data = rawKey)`, computed by
    `hashApiKeySecret` and stored hex-encoded.

```typescript
// src/stores.ts
export const hashApiKeySecret = (rawKey: string, salt: string): string =>
  createHmac("sha256", salt).update(rawKey).digest("hex");
```

A leaked snapshot (see [`src/persistence.ts`](../src/persistence.ts)) or a
copy of the in-memory store therefore exposes only `{ prefix, salt, hash }`
triples — never anything an attacker can present back to the API as a valid
credential.

**Why HMAC-SHA256 and not a slow KDF (bcrypt/scrypt/argon2)?** API keys are
high-entropy random tokens (128 bits of randomness from `randomUUID`), not
human-chosen secrets. A slow password KDF defends against dictionary/rainbow
attacks over a *low*-entropy input space; it buys nothing extra here and
would add real CPU cost to every authenticated request, since `requireScope`
re-verifies the hash on every call. A fast keyed hash is the right tool for
this input space.

### Verifying a key

`requireScope` (in `src/index.ts`) authenticates a request as follows:

1. Extract the raw key from the `Authorization: Bearer <key>` header.
2. Derive its `prefix` and look up the record in `apiKeyStore` by prefix.
3. Reject (`401`) if no record exists, or `isKeyValid` says it's expired /
   past its rotation grace window.
4. Reject (`401`) unless `verifyApiKeySecret(rawKey, record)` confirms the
   raw key hashes (with the record's stored salt) to the record's stored
   hash — compared with `crypto.timingSafeEqual`, not `===`, so a mismatch
   doesn't leak timing information about *where* the hash diverges.
5. Reject (`403`) if the record lacks the required scope.
6. On success, stamp `lastUsedAt` and call `next()`.

```typescript
// src/stores.ts
export const verifyApiKeySecret = (
  rawKey: string,
  record: Pick<ApiKeyRecord, "salt" | "hash">
): boolean => {
  const candidate = Buffer.from(hashApiKeySecret(rawKey, record.salt), "hex");
  const stored = Buffer.from(record.hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
};
```

Looking a key up by prefix alone is never sufficient to authenticate — the
full raw key must still hash to match, so a forged key sharing a real
key's prefix (a realistic risk given the prefix is only ~16 bits of
entropy) is rejected in step 4.

### Creating and rotating keys

`POST /api/v1/api-keys` and `POST /api/v1/api-keys/:prefix/rotate` mint a
fresh `srk_`-prefixed key, generate its salt/hash pair, and store the record
under the new key's prefix. **The full raw key is returned exactly once**,
in that creation/rotation response — it is never logged (`recordEvent` is
passed only `{ prefix, label }`) and is never retrievable again afterward.
If you lose it, rotate or delete the key and mint a new one.

Because the map is keyed by prefix, a fresh key's prefix must not collide
with one already in the store; both routes retry key generation in the
(astronomically unlikely, ~1-in-65536-per-attempt) event of a collision
before persisting the record — see `mintApiKey` in `src/index.ts`.

### Snapshot migration

Snapshots persisted before this change stored the *raw key itself* as the
`apiKeyStore` map key, in a record shape that predates the `salt`/`hash`
fields — exactly the recoverable material this change eliminates. Rather
than trust (or silently re-hash) a value that may already have been read
out of a leaked snapshot, `hydrateFromSnapshot` (`src/stores.ts`) discards
any `apiKeyStore` entry whose record doesn't already carry string `salt`
and `hash` fields, and logs a warning with the count of discarded records.
**Any key created before this migration must be recreated** — there is no
automatic re-issuance, since the server has no way to recover the plaintext
key needed to re-derive a hash for it.

## Never log raw key material

Audit events (`recordEvent`) only ever record the non-secret `prefix` and
`label` — never the raw key, salt, or hash. The pino logger additionally
redacts `authorization`/`x-api-key` header paths (see
[`src/logger.ts`](../src/logger.ts)) as defense in depth.

See [`src/__tests__/apiKeys.test.ts`](../src/__tests__/apiKeys.test.ts) for
lifecycle coverage (creation, listing, deletion, rotation, hash storage, and
snapshot migration), and
[`src/__tests__/apiKeyScopes.test.ts`](../src/__tests__/apiKeyScopes.test.ts)
for scope-enforcement coverage.
