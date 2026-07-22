import request from "supertest";
import app from "../index";
import { webhookStore } from "../stores";

beforeEach(() => webhookStore.clear());

describe("Webhooks lifecycle", () => {
  const validBody = {
    url: "https://example.com/hook",
    events: ["pair.registered"],
  };

  it("POST /api/v1/webhooks creates a webhook and returns 201", async () => {
    const res = await request(app).post("/api/v1/webhooks").send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^wh_/);
    expect(res.body.url).toBe(validBody.url);
    expect(res.body.events).toEqual(validBody.events);
  });

  it("GET /api/v1/webhooks lists all created webhooks", async () => {
    await request(app).post("/api/v1/webhooks").send(validBody);
    const res = await request(app).get("/api/v1/webhooks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
  });

  // ── GET /api/v1/webhooks/:id ───────────────────────────────────────────

  it("GET /api/v1/webhooks/:id returns the webhook", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app).get(`/api/v1/webhooks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.url).toBe(validBody.url);
    expect(res.body.events).toEqual(validBody.events);
    expect(res.body.createdAt).toEqual(expect.any(Number));
  });

  it("GET /api/v1/webhooks/:id returns 404 for unknown id", async () => {
    const res = await request(app).get("/api/v1/webhooks/wh_nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.requestId).toBeDefined();
  });

  // ── PATCH /api/v1/webhooks/:id ─────────────────────────────────────────

  it("PATCH /api/v1/webhooks/:id updates events and preserves url", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const newEvents = ["quote.requested", "quote.fulfilled"];
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: newEvents });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.url).toBe(validBody.url); // url preserved
    expect(res.body.events).toEqual(newEvents);
    expect(res.body.createdAt).toEqual(expect.any(Number));
    // Confirm the store was updated
    const getRes = await request(app).get(`/api/v1/webhooks/${id}`);
    expect(getRes.body.events).toEqual(newEvents);
  });

  it("PATCH /api/v1/webhooks/:id returns 404 for unknown id", async () => {
    const res = await request(app)
      .patch("/api/v1/webhooks/wh_nonexistent")
      .send({ events: ["pair.registered"] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.requestId).toBeDefined();
  });

  it("PATCH rejects empty events array", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("PATCH rejects non-string event entries", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["pair.registered", 123] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/non-empty string array/);
  });

  it("PATCH rejects unknown body keys (including url)", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["pair.registered"], url: "https://evil.com/hook" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/unknown field/);
    expect(res.body.unknownKeys).toContain("url");
  });

  it("PATCH deduplicates duplicate event names", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({
        events: [
          "pair.registered",
          "pair.registered",
          "quote.fulfilled",
          "quote.fulfilled",
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(["pair.registered", "quote.fulfilled"]);
  });

  it("PATCH rejects invalid event name format", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["not.a.real.event"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/namespace\.action/);
  });

  it("PATCH rejects reserved event prefix", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["internal.secret"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/reserved prefix/);
  });

  it("PATCH rejects blank event name", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["   "] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/blank or whitespace-only/);
  });

  it("PATCH rejects more than WEBHOOK_MAX_EVENTS events", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const tooMany = Array.from({ length: 21 }, (_, i) => `test.event${i}`);
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/at most 20/);
  });

  it("PATCH rejects overly long event name", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const longName = "x".repeat(129);
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: [longName] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/<= 128/);
  });

  it("PATCH accepts wildcard (*) event name", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const res = await request(app)
      .patch(`/api/v1/webhooks/${id}`)
      .send({ events: ["*"] });
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual(["*"]);
  });

  // ── DELETE (existing coverage preserved) ───────────────────────────────

  it("DELETE /api/v1/webhooks/:id removes the webhook", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const del = await request(app).delete(`/api/v1/webhooks/${id}`);
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/v1/webhooks");
    expect(list.body.items).toHaveLength(0);
  });

  it("DELETE unknown webhook id returns 404", async () => {
    const res = await request(app).delete("/api/v1/webhooks/wh_notreal");
    expect(res.status).toBe(404);
  });

  it("POST rejects missing url with 400", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ events: ["pair.registered"] });
    expect(res.status).toBe(400);
  });

  it.each([
    "http://localhost/hook",
    "http://LOCALHOST/hook",
    "http://127.0.0.1/hook",
    "http://10.0.0.5/hook",
    "http://172.16.0.10/hook",
    "http://192.168.1.9/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/hook",
    "http://[fe80::1]/hook",
  ])("POST rejects SSRF-prone webhook host %s", async (url) => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url, events: ["pair.registered"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/url host must be public/);
    expect(res.body.requestId).toBeDefined();
  });

  it("POST accepts a public https webhook URL", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({
        url: "https://hooks.example.com/stableroute",
        events: ["pair.registered"],
      });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe("https://hooks.example.com/stableroute");
  });

  it("POST rejects invalid events with 400", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com", events: ["not.a.real.event"] });
    expect(res.status).toBe(400);
  });

  it("POST deduplicates duplicate event names", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks")
      .send({
        url: "https://example.com/hook",
        events: ["pair.registered", "pair.registered"],
      });
    expect(res.status).toBe(201);
    expect(res.body.events).toEqual(["pair.registered"]);
  });
});
