# Admin bearer authentication

Administrative routes (`/api/v1/admin/*`, pause/unpause, read-only toggles)
require a bearer token matching `ADMIN_TOKEN` (or the configured secret).

Clients must send:

```
Authorization: Bearer <admin-token>
```

Missing or invalid tokens receive `401 unauthorized` with the standard
`{ error, message, requestId }` envelope. Never commit production tokens;
use `.env.example` for local development only.

Write routes for pairs and webhooks use **API keys** instead — see
`docs/api-key-auth.md`.
