import request from "supertest";
import app from "../index";

const expectCanonicalError = (
  body: Record<string, unknown>,
  requestId: string,
  error: string
) => {
  expect(body.error).toBe(error);
  expect(body.message).toBeTruthy();
  expect(body.requestId).toBe(requestId);
};

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
