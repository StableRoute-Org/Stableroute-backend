# Admin bearer authentication

Administrative routes (`/api/v1/admin/*` — pause, unpause, read-only, read-write,
and status) require a bearer token matching the `ADMIN_TOKEN` environment variable.

Clients must send:

```
Authorization: Bearer <ADMIN_TOKEN>
```

Missing or invalid tokens receive `401 unauthorized` with the standard
`{ error, message, requestId }` envelope.

## Constant-time comparison

All token comparisons are performed with `crypto.timingSafeEqual` via the
`timingSafeCompare` helper exported from `src/index.ts`. This prevents
timing-based side-channel attacks where an attacker can infer how many leading
characters of their guess matched the stored secret from differences in response
latency.

### How it works

Naïve string equality (`===`) exits as soon as the first mismatched character is
found. An attacker sending many requests with different prefixes can detect the
slightly-longer response time caused by each additional matching prefix character,
effectively brute-forcing the secret one character at a time.

`timingSafeCompare` avoids this by:

1. Encoding both strings to UTF-8 `Buffer`s.
2. Zero-padding the shorter buffer to match the length of the longer one.
3. Calling `crypto.timingSafeEqual` on the two equal-length buffers so the
   comparison always performs the same amount of work regardless of where the
   strings first differ.
4. Only returning `true` when the byte-lengths are also equal, ensuring a
   shorter token can never succeed by being a prefix of the correct value.

### Configuration

| Variable      | Required | Description                                      |
| ------------- | -------- | ------------------------------------------------ |
| `ADMIN_TOKEN` | No*      | Bearer token protecting all `/api/v1/admin/*` routes |

\* When `ADMIN_TOKEN` is unset the admin middleware passes all requests through.
This preserves compatibility for local development. **Always set `ADMIN_TOKEN` in
production.** A startup warning is emitted when the variable is absent.

```bash
# .env (never commit this file)
ADMIN_TOKEN=<long-random-secret>
```

Use a cryptographically random value of at least 32 characters. A convenient
way to generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API key authentication

Write routes for pairs and webhooks use **API keys** instead of the admin bearer
token — see `docs/api-key-auth.md`.

API key secrets are stored as HMAC-SHA256 hashes (never plaintext) and verified
with `crypto.timingSafeEqual` inside `verifyApiKeySecret` in `src/stores.ts`,
applying the same timing-attack resistance as the admin token check.

## Never commit secrets

Use `.env.example` for local development templates. The `.env` file is
git-ignored; never add it to version control.
