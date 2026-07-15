# Module layout roadmap

`src/index.ts` currently hosts routing, middleware, stores, and handlers in
one file (issue #13). The intended split:

| Module | Responsibility |
|--------|----------------|
| `src/routers/` | Express route mounts (`pairs`, `webhooks`, `admin`) |
| `src/middleware/` | CORS, rate limit, security headers, pause guard |
| `src/stores.ts` | In-memory registries (already extracted) |
| `src/validation/` | Shared request validators |

New endpoints should prefer small router modules over growing `index.ts`.
See `docs/middleware-order.md` and `docs/architecture.md` for current flow.
