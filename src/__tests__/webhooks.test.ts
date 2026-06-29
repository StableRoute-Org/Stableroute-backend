import request from "supertest";
import app from "../index";
import { webhookStore } from "../stores";

beforeEach(() => webhookStore.clear());

describe("Webhooks lifecycle", () => {
  const validBody = { url: "https://example.com/hook", events: ["pair.registered"] };

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
    expect(Array.isArray(res.body.webhooks)).toBe(true);
    expect(res.body.webhooks).toHaveLength(1);
  });

  it("DELETE /api/v1/webhooks/:id removes the webhook", async () => {
    const create = await request(app).post("/api/v1/webhooks").send(validBody);
    const { id } = create.body;
    const del = await request(app).delete(`/api/v1/webhooks/${id}`);
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/v1/webhooks");
    expect(list.body.webhooks).toHaveLength(0);
  });

  it("DELETE unknown webhook id returns 404", async () => {
    const res = await request(app).delete("/api/v1/webhooks/wh_notreal");
    expect(res.status).toBe(404);
  });

  it("POST rejects missing url with 400", async () => {
    const res = await request(app).post("/api/v1/webhooks").send({ events: ["pair.registered"] });
    expect(res.status).toBe(400);
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
      .send({ url: "https://example.com/hook", events: ["pair.registered", "pair.registered"] });
    expect(res.status).toBe(201);
    expect(res.body.events).toEqual(["pair.registered"]);
  });
});
