import { type Request, type Response } from "express";
import request from "supertest";
import app, { requireScope } from "../index";
import {
  resetStores,
  apiKeyStore,
  hydrateFromSnapshot,
  getSnapshot,
  apiKeyPrefix,
  verifyApiKeySecret,
} from "../stores";

const expectCanonicalError = (
  body: Record<string, unknown>,
  requestId: string,
  error: string
) => {
  expect(body.error).toBe(error);
  expect(body.message).toBeTruthy();
  expect(body.requestId).toBe(requestId);
};

beforeEach(() => resetStores());

describe("api-keys lifecycle", () => {
  describe("POST /api/v1/api-keys", () => {
    it("creates a key with 201, srk_ prefix, and echoes the label", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "ci-runner" });
      expect(res.status).toBe(201);
      expect(typeof res.body.key).toBe("string");
      expect(res.body.key).toMatch(/^srk_[0-9a-f]+$/);
      expect(res.body.label).toBe("ci-runner");
    });

    it("rejects an empty label with 400 invalid_request + requestId", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "" });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
    });

    it("rejects a 65-char label with 400 invalid_request + requestId", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "a".repeat(65) });
      expect(res.status).toBe(400);
      expectCanonicalError(res.body, res.headers["x-request-id"], "invalid_request");
    });

    it("accepts a 64-char label (boundary)", async () => {
      const res = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "b".repeat(64) });
      expect(res.status).toBe(201);
      expect(res.body.label).toBe("b".repeat(64));
    });
  });

  describe("GET /api/v1/api-keys", () => {
    it("lists items with prefix/label/createdAt and never exposes the raw key", async () => {
      const label = "list-suite-key";
      const created = await request(app)
        .post("/api/v1/api-keys")
        .send({ label });
      expect(created.status).toBe(201);
      const rawKey: string = created.body.key;
      const prefix = rawKey.slice(0, 8);

      const res = await request(app).get("/api/v1/api-keys");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);

      const mine = res.body.items.find(
        (it: { prefix: string; label: string }) =>
          it.prefix === prefix && it.label === label
      );
      expect(mine).toBeDefined();
      expect(mine).toHaveProperty("prefix");
      expect(mine).toHaveProperty("label");
      expect(mine).toHaveProperty("createdAt");
      expect(typeof mine.createdAt).toBe("number");

      // No item must carry a `key` field, and the raw key must not leak.
      for (const it of res.body.items) {
        expect(it).not.toHaveProperty("key");
      }
      expect(JSON.stringify(res.body)).not.toContain(rawKey);
    });
  });

  describe("DELETE /api/v1/api-keys/:prefix", () => {
    it("deletes by the 8-char prefix and returns 204", async () => {
      const created = await request(app)
        .post("/api/v1/api-keys")
        .send({ label: "delete-me" });
      expect(created.status).toBe(201);
      const prefix = (created.body.key as string).slice(0, 8);

      const del = await request(app).delete(`/api/v1/api-keys/${prefix}`);
      expect(del.status).toBe(204);
      expect(del.body).toEqual({});

      // Confirm it is gone from the listing.
      const res = await request(app).get("/api/v1/api-keys");
      const stillThere = res.body.items.find(
        (it: { prefix: string }) => it.prefix === prefix
      );
      expect(stillThere).toBeUndefined();
    });

    it("returns 404 not_found for an unknown prefix", async () => {
      const res = await request(app).delete("/api/v1/api-keys/deadbeef");
      expect(res.status).toBe(404);
      expectCanonicalError(res.body, res.headers["x-request-id"], "not_found");
    });
  });
});

describe("api-keys storage — salted hashes, never recoverable material", () => {
  it("never uses the raw key as the apiKeyStore map key", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "storage-check" });
    expect(created.status).toBe(201);
    const rawKey: string = created.body.key;

    expect(apiKeyStore.has(rawKey)).toBe(false);
    expect(apiKeyStore.has(apiKeyPrefix(rawKey))).toBe(true);
  });

  it("stores only a salt and hash on the record, never the raw key value", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "hash-shape-check" });
    expect(created.status).toBe(201);
    const rawKey: string = created.body.key;
    const record = apiKeyStore.get(apiKeyPrefix(rawKey));

    expect(record).toBeDefined();
    expect(typeof record!.salt).toBe("string");
    expect(typeof record!.hash).toBe("string");
    // sha256 hex digest is always 64 chars, regardless of the raw key's length.
    expect(record!.hash).toMatch(/^[0-9a-f]{64}$/);
    // Neither field is (or embeds) the recoverable raw key.
    expect(record!.salt).not.toBe(rawKey);
    expect(record!.hash).not.toBe(rawKey);
    expect(record!.hash).not.toContain(rawKey);
    expect(JSON.stringify(record)).not.toContain(rawKey);
  });

  it("generates a distinct salt (and hash) per key", async () => {
    const a = await request(app).post("/api/v1/api-keys").send({ label: "key-a" });
    const b = await request(app).post("/api/v1/api-keys").send({ label: "key-b" });

    const recordA = apiKeyStore.get(apiKeyPrefix(a.body.key));
    const recordB = apiKeyStore.get(apiKeyPrefix(b.body.key));

    expect(recordA!.salt).not.toBe(recordB!.salt);
    expect(recordA!.hash).not.toBe(recordB!.hash);
  });

  it("verifyApiKeySecret confirms the raw key against its own record", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "verify-check" });
    const rawKey: string = created.body.key;
    const record = apiKeyStore.get(apiKeyPrefix(rawKey));

    expect(verifyApiKeySecret(rawKey, record!)).toBe(true);
  });

  it("verifyApiKeySecret rejects a tampered raw key against a real record", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "tamper-check" });
    const rawKey: string = created.body.key;
    const record = apiKeyStore.get(apiKeyPrefix(rawKey));

    const tampered = rawKey.slice(0, -1) + (rawKey.at(-1) === "0" ? "1" : "0");
    expect(verifyApiKeySecret(tampered, record!)).toBe(false);
  });

  it("verifyApiKeySecret rejects the correct raw key against the wrong record", async () => {
    const a = await request(app).post("/api/v1/api-keys").send({ label: "wrong-record-a" });
    const b = await request(app).post("/api/v1/api-keys").send({ label: "wrong-record-b" });

    const recordB = apiKeyStore.get(apiKeyPrefix(b.body.key));
    expect(verifyApiKeySecret(a.body.key, recordB!)).toBe(false);
  });
});

describe("api-keys — requireScope authenticates via hash comparison", () => {
  const makeProtectedApp = () => {
    const middleware = requireScope("pairs:write");
    return (rawKey: string | undefined) => {
      const req = {
        header: jest.fn().mockReturnValue(rawKey ? `Bearer ${rawKey}` : undefined),
      } as unknown as Request;
      const json = jest.fn();
      const res = { status: jest.fn().mockReturnThis(), json } as unknown as Response;
      const next = jest.fn();
      middleware(req, res, next);
      return { req, res, next, json };
    };
  };

  it("authenticates a freshly created key end-to-end", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "auth-e2e", scopes: ["pairs:write"] });
    const rawKey: string = created.body.key;

    const { next, res } = makeProtectedApp()(rawKey);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a forged key that shares the real prefix but has the wrong suffix", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "prefix-forge", scopes: ["pairs:write"] });
    const rawKey: string = created.body.key;
    const prefix = apiKeyPrefix(rawKey);

    // Same lookup prefix as the real key, but a different (forged) suffix —
    // this only succeeds if auth actually verifies the full key against the
    // stored hash, rather than trusting presence of a matching prefix.
    const forged = prefix + "0".repeat(rawKey.length - prefix.length);
    expect(forged).not.toBe(rawKey);

    const { next, res } = makeProtectedApp()(forged);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("api-keys — rotation preserves per-key salted hashing", () => {
  it("the rotated successor has its own distinct prefix, salt, and hash", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "rotate-hash-check" });
    const rawKey: string = created.body.key;
    const prefix = apiKeyPrefix(rawKey);
    const predecessorBefore = apiKeyStore.get(prefix);

    const rotated = await request(app).post(`/api/v1/api-keys/${prefix}/rotate`);
    expect(rotated.status).toBe(201);
    const newKey: string = rotated.body.key;
    const newPrefix = apiKeyPrefix(newKey);

    expect(newPrefix).not.toBe(prefix);

    const predecessorAfter = apiKeyStore.get(prefix);
    const successor = apiKeyStore.get(newPrefix);

    // Predecessor's hash/salt are untouched by rotation — only rotation
    // metadata changes.
    expect(predecessorAfter!.salt).toBe(predecessorBefore!.salt);
    expect(predecessorAfter!.hash).toBe(predecessorBefore!.hash);
    expect(predecessorAfter!.rotatedAt).toBeDefined();
    expect(predecessorAfter!.graceExpiresAt).toBeDefined();

    // Successor has its own independent salt/hash that verifies the new raw key.
    expect(successor).toBeDefined();
    expect(successor!.salt).not.toBe(predecessorBefore!.salt);
    expect(verifyApiKeySecret(newKey, successor!)).toBe(true);
    expect(verifyApiKeySecret(rawKey, successor!)).toBe(false);
  });
});

describe("api-keys — snapshot migration invalidates legacy plaintext-derived records", () => {
  it("drops an apiKeyStore entry whose record predates the salt/hash fields", () => {
    const legacyRawKey = "srk_legacyplaintextderived000000";
    hydrateFromSnapshot({
      pairRegistry: [],
      pairMeta: [],
      apiKeyStore: [[legacyRawKey, { label: "legacy", createdAt: 1, scopes: ["keys:admin"] }]],
      webhookStore: [],
      eventLog: [],
    });

    // Neither the legacy raw-key-as-map-key form, nor its derived prefix,
    // survive hydration — the record is discarded outright.
    expect(apiKeyStore.has(legacyRawKey)).toBe(false);
    expect(apiKeyStore.has(apiKeyPrefix(legacyRawKey))).toBe(false);
    expect(apiKeyStore.size).toBe(0);
  });

  it("keeps a well-formed post-migration record (with salt/hash) intact", () => {
    hydrateFromSnapshot({
      pairRegistry: [],
      pairMeta: [],
      apiKeyStore: [["srk_curr", { label: "current", createdAt: 1, scopes: [], salt: "s", hash: "h" }]],
      webhookStore: [],
      eventLog: [],
    });

    expect(apiKeyStore.get("srk_curr")).toEqual({
      label: "current",
      createdAt: 1,
      scopes: [],
      salt: "s",
      hash: "h",
    });
  });

  it("a key created after migration is never itself invalidated by hydration", async () => {
    const created = await request(app)
      .post("/api/v1/api-keys")
      .send({ label: "post-migration-key" });
    const rawKey: string = created.body.key;
    const prefix = apiKeyPrefix(rawKey);

    const snapshot = getSnapshot();
    hydrateFromSnapshot(snapshot);

    expect(apiKeyStore.has(prefix)).toBe(true);
    expect(verifyApiKeySecret(rawKey, apiKeyStore.get(prefix)!)).toBe(true);
  });
});
