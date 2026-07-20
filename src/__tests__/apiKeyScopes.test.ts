/**
 * Comprehensive tests for API-key scope creation, listing, and enforcement.
 *
 * Covers:
 *  - POST /api/v1/api-keys with explicit scopes
 *  - POST /api/v1/api-keys defaulting to read-only (empty scopes)
 *  - Rejection of unknown scope strings (400 invalid_request)
 *  - Rejection of malformed scopes field
 *  - GET /api/v1/api-keys surfaces scopes in each listing item
 *  - requireScope HTTP-level 403 response via a test route
 *  - requireScope 401 for missing / invalid / expired key
 *  - SCOPE_CATALOG export contract
 */

import { type Request, type Response } from "express";
import express from "express";
import request from "supertest";
import app, { requireScope, SCOPE_CATALOG } from "../index";
import { resetStores, apiKeyStore } from "../stores";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const expectCanonicalError = (
  body: Record<string, unknown>,
  requestId: string,
  error: string,
) => {
  expect(body.error).toBe(error);
  expect(body.message).toBeTruthy();
  expect(body.requestId).toBe(requestId);
};

/** Create a key via POST and return the full response body. */
const createKey = (
  label: string,
  extra: Record<string, unknown> = {},
) =>
  request(app)
    .post("/api/v1/api-keys")
    .set("Content-Type", "application/json")
    .send({ label, ...extra });

// ──────────────────────────────────────────────────────────────────────────────
// Test-route for requireScope HTTP integration
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal express app that mounts a protected route using
 * `requireScope`. We reuse the main `app`'s shared stores so keys
 * created via POST /api/v1/api-keys are immediately visible to the
 * requireScope middleware without any extra setup.
 *
 * A fresh mini-app is used to avoid mutating the main router, while
 * still sharing the `apiKeyStore` module-level reference.
 */
const makeProtectedApp = (scope: string) => {
  const miniApp = express();
  miniApp.use(express.json());
  miniApp.get("/protected", requireScope(scope), (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return miniApp;
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("API-key scopes", () => {
  beforeEach(() => {
    resetStores();
  });

  // ── SCOPE_CATALOG contract ─────────────────────────────────────────────────

  describe("SCOPE_CATALOG", () => {
    it("is exported and contains the three documented scopes", () => {
      expect(SCOPE_CATALOG).toContain("pairs:write");
      expect(SCOPE_CATALOG).toContain("webhooks:write");
      expect(SCOPE_CATALOG).toContain("keys:admin");
    });

    it("contains exactly three entries", () => {
      expect(SCOPE_CATALOG).toHaveLength(3);
    });
  });

  // ── POST /api/v1/api-keys — scope creation ─────────────────────────────────

  describe("POST /api/v1/api-keys — scope creation", () => {
    it("defaults to read-only (empty scopes array) when scopes is omitted", async () => {
      const res = await createKey("read-only-key");
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual([]);
    });

    it("response includes the scopes array", async () => {
      const res = await createKey("write-key", { scopes: ["pairs:write"] });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(["pairs:write"]);
    });

    it("accepts all valid scope values individually", async () => {
      for (const scope of SCOPE_CATALOG) {
        const res = await createKey(`key-${scope}`, { scopes: [scope] });
        expect(res.status).toBe(201);
        expect(res.body.scopes).toContain(scope);
      }
    });

    it("accepts multiple valid scopes in one request", async () => {
      const scopes = ["pairs:write", "webhooks:write"];
      const res = await createKey("multi-scope", { scopes });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(expect.arrayContaining(scopes));
      expect(res.body.scopes).toHaveLength(2);
    });

    it("accepts all three scopes together", async () => {
      const all = [...SCOPE_CATALOG];
      const res = await createKey("admin-key", { scopes: all });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(expect.arrayContaining(all));
      expect(res.body.scopes).toHaveLength(3);
    });

    it("deduplicates repeated scopes", async () => {
      const res = await createKey("dup-scope", {
        scopes: ["pairs:write", "pairs:write"],
      });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(["pairs:write"]);
    });

    it("accepts empty scopes array explicitly (read-only)", async () => {
      const res = await createKey("explicit-readonly", { scopes: [] });
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual([]);
    });

    it("rejects an unknown scope with 400 invalid_request", async () => {
      const res = await createKey("bad-scope", { scopes: ["dne:scope"] });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
      expect((res.body.message as string).toLowerCase()).toMatch(/unknown scope/);
    });

    it("rejects a mix of valid and unknown scopes with 400 invalid_request", async () => {
      const res = await createKey("mix-scope", {
        scopes: ["pairs:write", "bad:scope"],
      });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
    });

    it("rejects scopes that is not an array with 400 invalid_request", async () => {
      const res = await createKey("str-scope", { scopes: "pairs:write" });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
    });

    it("rejects scopes array containing non-string values with 400 invalid_request", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ label: "num-scope", scopes: [1, 2, 3] }));
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
    });

    it("never exposes the raw key in the scope rejection response", async () => {
      const res = await createKey("leak-check", { scopes: ["bad:scope"] });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/srk_/);
    });
  });

  // ── GET /api/v1/api-keys — scopes in listing ──────────────────────────────

  describe("GET /api/v1/api-keys — scopes surfaced in listing", () => {
    it("lists scopes for a key created with explicit scopes", async () => {
      const created = await createKey("scope-list-key", {
        scopes: ["pairs:write"],
      });
      expect(created.status).toBe(201);
      const prefix = (created.body.key as string).slice(0, 8);

      const res = await request(app).get("/api/v1/api-keys");
      expect(res.status).toBe(200);

      const item = res.body.items.find(
        (it: { prefix: string }) => it.prefix === prefix,
      );
      expect(item).toBeDefined();
      expect(item.scopes).toEqual(["pairs:write"]);
    });

    it("lists scopes as an empty array for a read-only (default) key", async () => {
      const created = await createKey("readonly-list-key");
      expect(created.status).toBe(201);
      const prefix = (created.body.key as string).slice(0, 8);

      const res = await request(app).get("/api/v1/api-keys");
      expect(res.status).toBe(200);

      const item = res.body.items.find(
        (it: { prefix: string }) => it.prefix === prefix,
      );
      expect(item).toBeDefined();
      expect(item.scopes).toEqual([]);
    });

    it("lists scopes for a key created with multiple scopes", async () => {
      const scopes = ["webhooks:write", "keys:admin"];
      const created = await createKey("multi-scope-list", { scopes });
      expect(created.status).toBe(201);
      const prefix = (created.body.key as string).slice(0, 8);

      const res = await request(app).get("/api/v1/api-keys");
      const item = res.body.items.find(
        (it: { prefix: string }) => it.prefix === prefix,
      );
      expect(item.scopes).toEqual(expect.arrayContaining(scopes));
      expect(item.scopes).toHaveLength(2);
    });

    it("never exposes the raw key value in the listing response", async () => {
      const created = await createKey("no-leak-key", {
        scopes: ["pairs:write"],
      });
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;

      const res = await request(app).get("/api/v1/api-keys");
      expect(JSON.stringify(res.body)).not.toContain(rawKey);
    });

    it("each item has a scopes field (array)", async () => {
      await createKey("key-a", { scopes: ["pairs:write"] });
      await createKey("key-b");

      const res = await request(app).get("/api/v1/api-keys");
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(Array.isArray(item.scopes)).toBe(true);
      }
    });
  });

  // ── requireScope — 401/403 HTTP-level enforcement ─────────────────────────

  describe("requireScope — HTTP-level enforcement", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const protectedApp = makeProtectedApp("pairs:write");
      const res = await request(protectedApp).get("/protected");
      expect(res.status).toBe(401);
    });

    it("returns 401 for an unknown key", async () => {
      const protectedApp = makeProtectedApp("pairs:write");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", "Bearer srk_unknownkey");
      expect(res.status).toBe(401);
    });

    it("returns 401 for an expired key", async () => {
      // Inject an expired key directly into the store
      const rawKey = "srk_expired_scope_test_____00000";
      apiKeyStore.set(rawKey, {
        label: "expired",
        createdAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1,       // expired 1 ms ago
        scopes: ["pairs:write"],
      });

      const protectedApp = makeProtectedApp("pairs:write");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);
      expect(res.status).toBe(401);
    });

    it("returns 403 when the key lacks the required scope", async () => {
      const created = await createKey("no-scope-key");
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;

      const protectedApp = makeProtectedApp("pairs:write");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).toBe(403);
    });

    it("returns 403 response body with canonical error shape", async () => {
      // Build an app with sendError — but since makeProtectedApp is a mini-app
      // it won't have the full error middleware. Instead we mount requireScope
      // as pure Express middleware and inspect the json call via mocks.
      const rawKey = "srk_noscopemock__000000000000000";
      apiKeyStore.set(rawKey, {
        label: "no-scope",
        createdAt: Date.now(),
        scopes: [],
      });

      const middleware = requireScope("pairs:write");
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${rawKey}`),
        requestId: "test-req-id",
      } as unknown as Request;
      const json = jest.fn();
      const res = {
        status: jest.fn().mockReturnThis(),
        json,
      } as unknown as Response;
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      const body = json.mock.calls[0][0] as Record<string, unknown>;
      expect(body.error).toBe("forbidden");
      expect((body.message as string)).toMatch(/pairs:write/);
      expect(next).not.toHaveBeenCalled();
    });

    it("allows access and calls next() when key has the required scope", async () => {
      const created = await createKey("scoped-key", {
        scopes: ["pairs:write"],
      });
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;

      const protectedApp = makeProtectedApp("pairs:write");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it("allows access when key has multiple scopes including the required one", async () => {
      const created = await createKey("multi-scope-key", {
        scopes: ["pairs:write", "webhooks:write"],
      });
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;

      const protectedApp = makeProtectedApp("webhooks:write");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).toBe(200);
    });

    it("allows access with keys:admin scope", async () => {
      const created = await createKey("admin-key", {
        scopes: ["keys:admin"],
      });
      const rawKey: string = created.body.key;

      const protectedApp = makeProtectedApp("keys:admin");
      const res = await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);

      expect(res.status).toBe(200);
    });

    it("updates lastUsedAt on the store record after successful auth", async () => {
      const created = await createKey("lastused-key", {
        scopes: ["pairs:write"],
      });
      const rawKey: string = created.body.key;
      const beforeAuth = Date.now();

      const protectedApp = makeProtectedApp("pairs:write");
      await request(protectedApp)
        .get("/protected")
        .set("Authorization", `Bearer ${rawKey}`);

      const record = apiKeyStore.get(rawKey);
      expect(record!.lastUsedAt).toBeDefined();
      expect(record!.lastUsedAt!).toBeGreaterThanOrEqual(beforeAuth);
    });

    it("denies access with a read-only key (empty scopes) to a protected route", async () => {
      const created = await createKey("readonly-key");
      const rawKey: string = created.body.key;

      // Try all three scopes — should get 403 for each
      for (const scope of SCOPE_CATALOG) {
        const protectedApp = makeProtectedApp(scope);
        const res = await request(protectedApp)
          .get("/protected")
          .set("Authorization", `Bearer ${rawKey}`);
        expect(res.status).toBe(403);
      }
    });

    it("requireScope works correctly with Bearer token case-insensitivity", async () => {
      const created = await createKey("bearer-case-key", {
        scopes: ["pairs:write"],
      });
      const rawKey: string = created.body.key;

      const rawKey2 = "srk_bearer_case_test_0000000000";
      apiKeyStore.set(rawKey2, {
        label: "bearer-case",
        createdAt: Date.now(),
        scopes: ["pairs:write"],
      });

      const middleware = requireScope("pairs:write");
      const req = {
        header: jest.fn().mockReturnValue(`bearer ${rawKey}`), // lowercase "bearer"
        requestId: "case-req-id",
      } as unknown as Request;
      const next = jest.fn();
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      middleware(req, res, next);

      // Bearer is case-insensitive per the requireScope regex /^Bearer\s+/i
      expect(next).toHaveBeenCalled();
    });
  });

  // ── Scope inheritance through rotation ────────────────────────────────────

  describe("scope inheritance through key rotation", () => {
    it("rotated successor inherits the predecessor's scopes", async () => {
      const created = await createKey("rotate-scope-key", {
        scopes: ["pairs:write", "webhooks:write"],
      });
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;
      const prefix = rawKey.slice(0, 8);

      // Rotate the key
      const rotated = await request(app).post(
        `/api/v1/api-keys/${prefix}/rotate`,
      );
      expect(rotated.status).toBe(201);
      const newKey: string = rotated.body.key;

      // Check that the new key has the same scopes as the predecessor
      const newRecord = apiKeyStore.get(newKey);
      expect(newRecord!.scopes).toEqual(
        expect.arrayContaining(["pairs:write", "webhooks:write"]),
      );
      expect(newRecord!.scopes).toHaveLength(2);
    });
  });
});
