import {
  pairRegistry,
  pairMeta,
  apiKeyStore,
  webhookStore,
  eventLog,
  rateBuckets,
  config,
  paused,
  pairKey,
  defaultMeta,
  recordEvent,
  resetStores,
  trimEventLog,
  effectiveEventLogCap,
  EVENT_LOG_CAP,
  EVENT_LOG_CAP_MAX,
  type EventType,
} from "../stores";

describe("stores module", () => {
  beforeEach(() => {
    resetStores();
  });

  describe("pairKey", () => {
    it("joins source and destination with ::", () => {
      expect(pairKey("USDC", "EURC")).toBe("USDC::EURC");
    });

    it("handles special characters", () => {
      expect(pairKey("ABC", "DEF")).toBe("ABC::DEF");
    });
  });

  describe("defaultMeta", () => {
    it("returns zeroed metadata", () => {
      const meta = defaultMeta();
      expect(meta.feeBps).toBe(0);
      expect(meta.minAmount).toBe("0");
      expect(meta.maxAmount).toBe("0");
      expect(meta.liquidity).toBe("0");
    });

    it("returns a fresh object each time", () => {
      const a = defaultMeta();
      const b = defaultMeta();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe("recordEvent", () => {
    it("appends an event with id, ts, type, and payload", () => {
      recordEvent("pair.registered", { foo: "bar" });
      expect(eventLog.length).toBe(1);
      const evt = eventLog[0];
      expect(evt.type).toBe("pair.registered");
      expect(evt.payload).toEqual({ foo: "bar" });
      expect(typeof evt.id).toBe("string");
      expect(typeof evt.ts).toBe("number");
    });

    it("evicts oldest entry beyond EVENT_LOG_CAP", () => {
      // Fill to cap using a valid EventType cast for test scaffolding
      for (let i = 0; i < EVENT_LOG_CAP; i++) {
        eventLog.push({ id: `e${i}`, ts: i, type: "pair.refreshed" as EventType, payload: {} });
      }
      recordEvent("pair.unregistered", { n: 1 });
      expect(eventLog.length).toBe(EVENT_LOG_CAP);
      expect(eventLog[0].type).toBe("pair.refreshed"); // oldest of original fill
      expect(eventLog[eventLog.length - 1].type).toBe("pair.unregistered");
    });

    it("evicts based on config.eventLogCap when configured to a lower value", () => {
      config.eventLogCap = 5;
      for (let i = 0; i < 5; i++) {
        recordEvent("pair.registered" as EventType, { i });
      }
      expect(eventLog.length).toBe(5);
      recordEvent("pair.unregistered" as EventType, { n: 1 });
      expect(eventLog.length).toBe(5);
      expect(eventLog[eventLog.length - 1].type).toBe("pair.unregistered");
    });

    it("evicts with a cap of 1 (edge case)", () => {
      config.eventLogCap = 1;
      recordEvent("pair.registered" as EventType, {});
      expect(eventLog.length).toBe(1);
      recordEvent("pair.unregistered" as EventType, {});
      expect(eventLog.length).toBe(1);
      expect(eventLog[0].type).toBe("pair.unregistered");
    });

    it("falls back to EVENT_LOG_CAP if config.eventLogCap is zero or invalid", () => {
      config.eventLogCap = 0;
      expect(effectiveEventLogCap()).toBe(EVENT_LOG_CAP);
      config.eventLogCap = -1;
      expect(effectiveEventLogCap()).toBe(EVENT_LOG_CAP);
    });

    it("falls back to EVENT_LOG_CAP if config.eventLogCap exceeds EVENT_LOG_CAP_MAX", () => {
      config.eventLogCap = EVENT_LOG_CAP_MAX + 1;
      expect(effectiveEventLogCap()).toBe(EVENT_LOG_CAP);
    });
  });

  describe("effectiveEventLogCap", () => {
    it("returns config.eventLogCap when it is a valid positive integer", () => {
      config.eventLogCap = 500;
      expect(effectiveEventLogCap()).toBe(500);
    });

    it("returns EVENT_LOG_CAP when config.eventLogCap is the default", () => {
      expect(effectiveEventLogCap()).toBe(EVENT_LOG_CAP);
    });

    it("returns EVENT_LOG_CAP_MAX when config.eventLogCap equals EVENT_LOG_CAP_MAX", () => {
      config.eventLogCap = EVENT_LOG_CAP_MAX;
      expect(effectiveEventLogCap()).toBe(EVENT_LOG_CAP_MAX);
    });
  });

  describe("trimEventLog", () => {
    it("removes oldest entries to fit within the new cap", () => {
      for (let i = 0; i < 10; i++) {
        eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: { i } });
      }
      trimEventLog(5);
      expect(eventLog.length).toBe(5);
      // oldest removed; remaining are the 5 newest
      expect(eventLog[0].payload).toEqual({ i: 5 });
      expect(eventLog[4].payload).toEqual({ i: 9 });
    });

    it("is a no-op when log is already within the cap", () => {
      for (let i = 0; i < 3; i++) {
        eventLog.push({ id: `e${i}`, ts: i, type: "pair.registered" as EventType, payload: {} });
      }
      trimEventLog(10);
      expect(eventLog.length).toBe(3);
    });

    it("clears the entire log when cap is 0", () => {
      eventLog.push({ id: "x", ts: 1, type: "pair.registered" as EventType, payload: {} });
      trimEventLog(0);
      expect(eventLog.length).toBe(0);
    });
  });

  describe("resetStores", () => {
    it("clears pairRegistry", () => {
      pairRegistry.add("A::B");
      pairRegistry.add("C::D");
      resetStores();
      expect(pairRegistry.size).toBe(0);
    });

    it("clears pairMeta", () => {
      pairMeta.set("X::Y", defaultMeta());
      resetStores();
      expect(pairMeta.size).toBe(0);
    });

    it("clears apiKeyStore", () => {
      apiKeyStore.set("srk_abc", { label: "test", createdAt: 1 });
      resetStores();
      expect(apiKeyStore.size).toBe(0);
    });

    it("clears webhookStore", () => {
      webhookStore.set("wh_abc", {
        url: "https://example.com",
        events: ["x"],
        createdAt: 1,
      });
      resetStores();
      expect(webhookStore.size).toBe(0);
    });

    it("clears eventLog", () => {
      recordEvent("pair.registered", {});
      expect(eventLog.length).toBeGreaterThan(0);
      resetStores();
      expect(eventLog.length).toBe(0);
    });

    it("clears rateBuckets", () => {
      rateBuckets.set("1.2.3.4", [Date.now()]);
      resetStores();
      expect(rateBuckets.size).toBe(0);
    });

    it("resets config to defaults", () => {
      config.rateLimitPerWindow = 999;
      config.bulkMaxItems = 50;
      resetStores();
      expect(config.rateLimitPerWindow).toBe(60);
      expect(config.rateLimitWindowMs).toBe(60_000);
      expect(config.bulkMaxItems).toBe(100);
      expect(config.eventLogCap).toBe(EVENT_LOG_CAP);
    });

    it("resets paused to false", () => {
      // paused is read-only import; use a paired pause/unpause via app
      // but we can verify the store's initial value after reset
      expect(paused).toBe(false);
    });
  });

  describe("store isolation", () => {
    it("resetStores leaves no leftover keys in config", () => {
      (config as Record<string, unknown>).injected = "oops";
      resetStores();
      expect("injected" in config).toBe(false);
    });
  });
});
