import request from "supertest";
import app, { __testHooks } from "../index";

const uniqueAsset = (prefix: string, n: number) =>
  `${prefix}${n.toString().padStart(4, "0")}`.slice(0, 12);

const createPair = async (source: string, destination: string) =>
  request(app).post("/api/v1/pairs").send({ source, destination });

describe("audit event log", () => {
  beforeEach(() => {
    __testHooks.clearEventLog();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    __testHooks.clearEventLog();
  });

  it("filters events by since timestamp and excludes earlier events", async () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000);
    await createPair("SINC0001", "SINC0002");
    now.mockReturnValueOnce(2_000);
    await createPair("SINC0003", "SINC0004");

    const res = await request(app).get("/api/v1/events").query({ since: 1_500, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ts: 2_000,
          type: "pair.registered",
          payload: { source: "SINC0003", destination: "SINC0004" },
        }),
      ])
    );
    expect(
      res.body.items.some(
        (event: { payload?: { source?: string } }) => event.payload?.source === "SINC0001"
      )
    ).toBe(false);
  });

  it("clamps limit to at least one and returns the most recent event", async () => {
    await createPair("LIMI0001", "LIMI0002");
    await createPair("LIMI0003", "LIMI0004");

    const res = await request(app).get("/api/v1/events").query({ limit: 0 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      type: "pair.registered",
      payload: { source: "LIMI0003", destination: "LIMI0004" },
    });
  });

  it("clamps very large limits to the event log capacity", async () => {
    await createPair("HUGE0001", "HUGE0002");

    const res = await request(app).get("/api/v1/events").query({ limit: 100_001 });

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(10_000);
  });

  it("records pair.refreshed and pair.unregistered events", async () => {
    await createPair("EVNT0001", "EVNT0002");
    await createPair("EVNT0001", "EVNT0002");
    await request(app).delete("/api/v1/pairs/EVNT0001/EVNT0002");

    const res = await request(app).get("/api/v1/events").query({ limit: 20 });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "pair.refreshed",
          payload: { source: "EVNT0001", destination: "EVNT0002" },
        }),
        expect.objectContaining({
          type: "pair.unregistered",
          payload: { source: "EVNT0001", destination: "EVNT0002" },
        }),
      ])
    );
  });

  it("evicts the oldest event when the log exceeds capacity", async () => {
    __testHooks.recordEvent("pair.registered", {
      source: "CAPA0001",
      destination: "CAPA0002",
    });

    for (let i = 0; i < 10_000; i += 1) {
      __testHooks.recordEvent("pair.refreshed", {
        source: uniqueAsset("CAP", i),
        destination: "CAPA0002",
      });
    }

    const res = await request(app).get("/api/v1/events").query({ limit: 10_000 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(10_000);
    expect(res.body.items[0]).toMatchObject({ type: "pair.refreshed" });
    expect(
      res.body.items.some((event: { type: string }) => event.type === "pair.registered")
    ).toBe(false);
  });
});
