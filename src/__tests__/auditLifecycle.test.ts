import request from "supertest";
import app from "../index";
import { resetStores, setPaused } from "../stores";

beforeEach(() => resetStores());
afterEach(() => {
  resetStores();
  setPaused(false);
});

const fetchEvents = async () => {
  const res = await request(app).get("/api/v1/events");
  expect(res.status).toBe(200);
  return res.body.items as Array<{ type: string; payload: Record<string, unknown> }>;
};

describe("Audit events for lifecycle mutations", () => {
  it("records apikey.created (prefix+label, never the raw key) and apikey.deleted", async () => {
    const created = await request(app).post("/api/v1/api-keys").send({ label: "ci" });
    expect(created.status).toBe(201);
    const rawKey: string = created.body.key;
    const prefix = rawKey.slice(0, 8);

    let events = await fetchEvents();
    const createEvent = events.find((e) => e.type === "apikey.created");
    expect(createEvent).toBeDefined();
    expect(createEvent?.payload.prefix).toBe(prefix);
    expect(createEvent?.payload.label).toBe("ci");
    // No raw key material anywhere in the recorded payload.
    expect(JSON.stringify(createEvent?.payload)).not.toContain(rawKey);

    const del = await request(app).delete(`/api/v1/api-keys/${prefix}`);
    expect(del.status).toBe(204);
    events = await fetchEvents();
    expect(events.some((e) => e.type === "apikey.deleted" && e.payload.prefix === prefix)).toBe(true);
  });

  it("records webhook.created (id+url) and webhook.deleted", async () => {
    const created = await request(app)
      .post("/api/v1/webhooks")
      .send({ url: "https://example.com/hook", events: ["pair.registered"] });
    expect(created.status).toBe(201);
    const id: string = created.body.id;

    let events = await fetchEvents();
    const createEvent = events.find((e) => e.type === "webhook.created");
    expect(createEvent).toBeDefined();
    expect(createEvent?.payload.id).toBe(id);
    expect(createEvent?.payload.url).toBe("https://example.com/hook");

    const del = await request(app).delete(`/api/v1/webhooks/${id}`);
    expect(del.status).toBe(204);
    events = await fetchEvents();
    expect(events.some((e) => e.type === "webhook.deleted" && e.payload.id === id)).toBe(true);
  });

  it("records admin.paused and admin.unpaused", async () => {
    await request(app).post("/api/v1/admin/pause");
    await request(app).post("/api/v1/admin/unpause");
    const events = await fetchEvents();
    expect(events.some((e) => e.type === "admin.paused")).toBe(true);
    expect(events.some((e) => e.type === "admin.unpaused")).toBe(true);
  });
});
