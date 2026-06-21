import request from "supertest";
import app, { __testHooks } from "../index";

jest.setTimeout(30_000);

type EventItem = {
  ts: number;
  type: string;
  payload: {
    source?: string;
    destination?: string;
  };
};

const unique = (prefix: string, index: number) => `${prefix}${index.toString().padStart(5, "0")}`;
const eventIndex = (source: string) => Number(source.slice("E19C".length));

describe("audit events", () => {
  beforeEach(() => {
    __testHooks.clearEvents();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns events on or after since and excludes earlier pair events", async () => {
    const base = 9_000_000_000_000;
    let now = base;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "E19OLD", destination: "E19A" });

    now = base + 1_000;
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "E19NEW", destination: "E19B" });

    now = base + 2_000;
    await request(app).delete("/api/v1/pairs/E19NEW/E19B");

    const res = await request(app).get(`/api/v1/events?since=${base + 1_000}&limit=10`);

    expect(res.status).toBe(200);
    const items = res.body.items as EventItem[];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ts: base + 1_000,
          type: "pair.registered",
          payload: { source: "E19NEW", destination: "E19B" },
        }),
        expect.objectContaining({
          ts: base + 2_000,
          type: "pair.unregistered",
          payload: { source: "E19NEW", destination: "E19B" },
        }),
      ])
    );
    expect(
      items.some((event) => event.payload.source === "E19OLD" && event.payload.destination === "E19A")
    ).toBe(false);

    const future = await request(app).get(`/api/v1/events?since=${base + 3_000}`);
    expect(future.status).toBe(200);
    expect(future.body.items).toEqual([]);
  });

  it("records pair.refreshed and clamps limit to at least one most recent event", async () => {
    const base = 9_000_000_100_000;
    let now = base;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "E19REF", destination: "E19C" });

    now = base + 1_000;
    await request(app)
      .post("/api/v1/pairs")
      .send({ source: "E19REF", destination: "E19C" });

    const res = await request(app).get(`/api/v1/events?since=${base}&limit=0`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      ts: base + 1_000,
      type: "pair.refreshed",
      payload: { source: "E19REF", destination: "E19C" },
    });
  });

  it("returns the most recent N events after applying since", async () => {
    const base = 9_000_000_200_000;
    let now = base;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    for (let i = 0; i < 4; i += 1) {
      now = base + i;
      await request(app)
        .post("/api/v1/pairs")
        .send({ source: unique("E19L", i), destination: unique("E19D", i) });
    }

    const res = await request(app).get(`/api/v1/events?since=${base}&limit=2`);

    expect(res.status).toBe(200);
    expect((res.body.items as EventItem[]).map((event) => event.payload.source)).toEqual([
      "E19L00002",
      "E19L00003",
    ]);
  });

  it("caps the event log and evicts the oldest entries", async () => {
    const cap = __testHooks.EVENT_LOG_CAP;
    const base = 9_000_000_300_000;
    let now = base;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    for (let i = 0; i < cap + 5; i += 1) {
      now = base + i;
      __testHooks.recordEvent("pair.registered", {
        source: unique("E19C", i),
        destination: unique("E19K", i),
      });
    }

    const res = await request(app).get(`/api/v1/events?since=${base}&limit=${cap + 500}`);

    expect(res.status).toBe(200);
    const items = res.body.items as EventItem[];
    expect(items).toHaveLength(cap);
    const firstIndex = eventIndex(items[0].payload.source ?? "");
    const lastIndex = eventIndex(items[items.length - 1].payload.source ?? "");
    expect(firstIndex).toBeGreaterThan(0);
    expect(lastIndex).toBe(cap + 4);
    expect(items.some((event) => event.payload.source === "E19C00000")).toBe(false);
  });
});
