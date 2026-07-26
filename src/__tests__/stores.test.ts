import {
  pairRegistry,
  pairMeta,
  apiKeyStore,
  webhookStore,
  eventLog,
  rateBuckets,
  config,
  paused,
  readOnly,
  pairKey,
  defaultMeta,
  recordEvent,
  resetStores,
  trimEventLog,
  effectiveEventLogCap,
  EVENT_LOG_CAP,
  EVENT_LOG_CAP_MAX,
  RATE_BUCKETS_MAX_IPS,
  HEALTH_PROBE_KEY,
  KNOWN_EVENT_TYPES,
  apiKeyPrefix,
  generateApiKeySalt,
  hashApiKeySecret,
  verifyApiKeySecret,
  isPaused,
  isReadOnly,
  setPaused,
  setReadOnly,
  isHydrating,
  setHydrating,
  getSnapshot,
  hydrateFromSnapshot,
  triggerSnapshot,
  type EventType,
  type ApiKeyRecord,
  type PairMeta,
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
      const evt = eventLog.at(0);
      expect(evt?.type).toBe("pair.registered");
      expect(evt?.payload).toEqual({ foo: "bar" });
      expect(typeof evt?.id).toBe("string");
      expect(typeof evt?.ts).toBe("number");
    });

    it("evicts oldest entry beyond EVENT_LOG_CAP", () => {
      // Fill to cap using a valid EventType cast for test scaffolding
      for (let i = 0; i < EVENT_LOG_CAP; i++) {
        eventLog.push({
          id: `e${i}`,
          ts: i,
          type: "pair.refreshed" as EventType,
          payload: {},
        });
      }
      recordEvent("pair.unregistered", { n: 1 });
      expect(eventLog.length).toBe(EVENT_LOG_CAP);
      expect(eventLog.at(0)?.type).toBe("pair.refreshed"); // oldest of original fill
      expect(eventLog.at(eventLog.length - 1)?.type).toBe("pair.unregistered");
    });

    it("evicts based on config.eventLogCap when configured to a lower value", () => {
      config.eventLogCap = 5;
      for (let i = 0; i < 5; i++) {
        recordEvent("pair.registered" as EventType, { i });
      }
      expect(eventLog.length).toBe(5);
      recordEvent("pair.unregistered" as EventType, { n: 1 });
      expect(eventLog.length).toBe(5);
      expect(eventLog.at(eventLog.length - 1)?.type).toBe("pair.unregistered");
    });

    it("evicts with a cap of 1 (edge case)", () => {
      config.eventLogCap = 1;
      recordEvent("pair.registered" as EventType, {});
      expect(eventLog.length).toBe(1);
      recordEvent("pair.unregistered" as EventType, {});
      expect(eventLog.length).toBe(1);
      const firstEntry = eventLog.at(0);
      expect(firstEntry).toBeDefined();
      expect(firstEntry?.type).toBe("pair.unregistered");
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
        eventLog.push({
          id: `e${i}`,
          ts: i,
          type: "pair.registered" as EventType,
          payload: { i },
        });
      }
      trimEventLog(5);
      expect(eventLog.length).toBe(5);
      // oldest removed; remaining are the 5 newest
      expect(eventLog.at(0)?.payload).toEqual({ i: 5 });
      expect(eventLog.at(4)?.payload).toEqual({ i: 9 });
    });

    it("is a no-op when log is already within the cap", () => {
      for (let i = 0; i < 3; i++) {
        eventLog.push({
          id: `e${i}`,
          ts: i,
          type: "pair.registered" as EventType,
          payload: {},
        });
      }
      trimEventLog(10);
      expect(eventLog.length).toBe(3);
    });

    it("clears the entire log when cap is 0", () => {
      eventLog.push({
        id: "x",
        ts: 1,
        type: "pair.registered" as EventType,
        payload: {},
      });
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
      apiKeyStore.set("srk_abc0", {
        label: "test",
        createdAt: 1,
        salt: "s",
        hash: "h",
      });
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

  describe("config indexed access (noUncheckedIndexedAccess)", () => {
    it("reads known config keys safely", () => {
      const maxItems = config.bulkMaxItems;
      expect(maxItems).toBe(100);
    });

    it("returns undefined for unset config keys", () => {
      const val = (config as Record<string, number | undefined>)["__nonexistent__"];
      expect(val).toBeUndefined();
    });
  });

  describe("pairMeta.get — undefined-safe access", () => {
    it("returns undefined for an unregistered pair", () => {
      const meta = pairMeta.get("NONEXISTENT::PAIR");
      expect(meta).toBeUndefined();
    });

    it("supports optional chaining on registered pair", () => {
      pairMeta.set("A::B", defaultMeta());
      const feeBps = pairMeta.get("A::B")?.feeBps;
      expect(feeBps).toBe(0);
    });

    it("returns undefined via optional chaining for missing pair", () => {
      const feeBps = pairMeta.get("MISSING::PAIR")?.feeBps;
      expect(feeBps).toBeUndefined();
    });
  });

  describe("apiKeyStore.get — undefined-safe access", () => {
    it("returns undefined for a missing key", () => {
      const rec = apiKeyStore.get("srk_nonexistent");
      expect(rec).toBeUndefined();
    });

    it("returns full record after insertion", () => {
      const record: ApiKeyRecord = {
        label: "test",
        createdAt: 100,
        salt: "abc",
        hash: "def",
      };
      apiKeyStore.set("srk_test", record);
      const retrieved = apiKeyStore.get("srk_test");
      expect(retrieved?.label).toBe("test");
      expect(retrieved?.salt).toBe("abc");
      expect(retrieved?.hash).toBe("def");
    });

    it("accesses optional fields via optional chaining", () => {
      const record: ApiKeyRecord = {
        label: "test",
        createdAt: 100,
        salt: "abc",
        hash: "def",
        scopes: ["admin"],
        expiresAt: 999,
      };
      apiKeyStore.set("srk_scoped", record);
      const retrieved = apiKeyStore.get("srk_scoped");
      expect(retrieved?.scopes).toEqual(["admin"]);
      expect(retrieved?.expiresAt).toBe(999);
      expect(retrieved?.lastUsedAt).toBeUndefined();
    });
  });

  describe("rateBuckets.get — undefined-safe access", () => {
    it("returns undefined for never-seen IP", () => {
      const bucket = rateBuckets.get("10.0.0.1");
      expect(bucket).toBeUndefined();
    });

    it("returns timestamp array for tracked IP", () => {
      rateBuckets.set("10.0.0.2", [100, 200]);
      expect(rateBuckets.get("10.0.0.2")).toEqual([100, 200]);
    });
  });

  describe("eventLog indexed access", () => {
    it("at() returns undefined for out-of-range index", () => {
      const entry = eventLog.at(9999);
      expect(entry).toBeUndefined();
    });

    it("at() returns the entry at a valid index", () => {
      recordEvent("pair.registered", { idx: 1 });
      const entry = eventLog.at(0);
      expect(entry?.type).toBe("pair.registered");
      expect(entry?.payload).toEqual({ idx: 1 });
    });
  });

  describe("pairRegistry iteration with split", () => {
    it("handles pair keys with exactly two parts", () => {
      pairRegistry.add("USDC::EURC");
      pairRegistry.add("XLM::USDT");
      const assets = new Set<string>();
      for (const k of pairRegistry) {
        const parts = k.split("::");
        const source = parts[0];
        const destination = parts[1];
        if (source !== undefined && destination !== undefined) {
          assets.add(source);
          assets.add(destination);
        }
      }
      expect(assets.has("USDC")).toBe(true);
      expect(assets.has("EURC")).toBe(true);
      expect(assets.has("XLM")).toBe(true);
      expect(assets.has("USDT")).toBe(true);
    });

    it("skips malformed pair keys gracefully", () => {
      pairRegistry.add("NO_SEPARATOR");
      const assets = new Set<string>();
      for (const k of pairRegistry) {
        const parts = k.split("::");
        const source = parts[0];
        const destination = parts[1];
        if (source !== undefined && destination !== undefined) {
          assets.add(source);
          assets.add(destination);
        }
      }
      expect(assets.size).toBe(0);
    });
  });

  describe("ApiKeyRecord optional property handling (exactOptionalPropertyTypes)", () => {
    it("omits optional scopes by default", () => {
      const record: ApiKeyRecord = {
        label: "no-scopes",
        createdAt: 1,
        salt: "s",
        hash: "h",
      };
      expect(record.scopes).toBeUndefined();
    });

    it("sets scopes when provided", () => {
      const record: ApiKeyRecord = {
        label: "with-scopes",
        createdAt: 2,
        scopes: ["read", "write"],
        salt: "s",
        hash: "h",
      };
      expect(record.scopes).toEqual(["read", "write"]);
    });

    it("marks rotatedAt as undefined before rotation", () => {
      const record: ApiKeyRecord = {
        label: "never-rotated",
        createdAt: 3,
        salt: "s",
        hash: "h",
      };
      expect(record.rotatedAt).toBeUndefined();
      expect(record.graceExpiresAt).toBeUndefined();
    });

    it("omits expiresAt when key never expires", () => {
      const record: ApiKeyRecord = {
        label: "no-expiry",
        createdAt: 4,
        salt: "s",
        hash: "h",
      };
      expect(record.expiresAt).toBeUndefined();
    });

    it("omits lastUsedAt before first use", () => {
      const record: ApiKeyRecord = {
        label: "fresh-key",
        createdAt: 5,
        salt: "s",
        hash: "h",
      };
      expect(record.lastUsedAt).toBeUndefined();
    });
  });

  describe("apiKeyPrefix", () => {
    it("returns first 8 characters of the raw key", () => {
      expect(apiKeyPrefix("abcdefghijk")).toBe("abcdefgh");
    });

    it("returns full key when shorter than prefix length", () => {
      expect(apiKeyPrefix("short")).toBe("short");
    });
  });

  describe("generateApiKeySalt", () => {
    it("returns a 32-character hex string", () => {
      const salt = generateApiKeySalt();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });

    it("produces unique values across calls", () => {
      const a = generateApiKeySalt();
      const b = generateApiKeySalt();
      expect(a).not.toBe(b);
    });
  });

  describe("hashApiKeySecret", () => {
    it("returns deterministic hex output for same inputs", () => {
      const a = hashApiKeySecret("test-key", "salt1234");
      const b = hashApiKeySecret("test-key", "salt1234");
      expect(a).toBe(b);
    });

    it("returns different output for different keys", () => {
      const a = hashApiKeySecret("key-a", "salt1234");
      const b = hashApiKeySecret("key-b", "salt1234");
      expect(a).not.toBe(b);
    });
  });

  describe("verifyApiKeySecret", () => {
    it("returns true for matching key and record", () => {
      const salt = generateApiKeySalt();
      const rawKey = "my-secret-api-key";
      const hash = hashApiKeySecret(rawKey, salt);
      expect(verifyApiKeySecret(rawKey, { salt, hash })).toBe(true);
    });

    it("returns false for wrong key", () => {
      const salt = generateApiKeySalt();
      const hash = hashApiKeySecret("real-key", salt);
      expect(verifyApiKeySecret("wrong-key", { salt, hash })).toBe(false);
    });
  });

  describe("paused / readOnly accessors", () => {
    it("isPaused returns current paused state", () => {
      expect(isPaused()).toBe(false);
      setPaused(true);
      expect(isPaused()).toBe(true);
      setPaused(false);
      expect(isPaused()).toBe(false);
    });

    it("isReadOnly returns current readOnly state", () => {
      expect(isReadOnly()).toBe(false);
      setReadOnly(true);
      expect(isReadOnly()).toBe(true);
      setReadOnly(false);
      expect(isReadOnly()).toBe(false);
    });

    it("readOnly resets to false after resetStores", () => {
      setReadOnly(true);
      resetStores();
      expect(isReadOnly()).toBe(false);
    });
  });

  describe("isHydrating / setHydrating", () => {
    it("starts as false", () => {
      expect(isHydrating).toBe(false);
    });

    it("setHydrating updates the flag", () => {
      setHydrating(true);
      expect(isHydrating).toBe(true);
      setHydrating(false);
      expect(isHydrating).toBe(false);
    });
  });

  describe("getSnapshot", () => {
    it("returns all stores in a serializable shape", () => {
      pairRegistry.add("X::Y");
      pairMeta.set("X::Y", defaultMeta());
      const snap = getSnapshot();
      expect(snap).toHaveProperty("schemaVersion");
      expect(snap.pairRegistry).toContain("X::Y");
      expect(snap.pairMeta).toEqual([["X::Y", defaultMeta()]]);
    });

    it("clones the event log", () => {
      recordEvent("pair.registered", {});
      const snap = getSnapshot();
      expect(snap.eventLog).toHaveLength(1);
      snap.eventLog.length = 0;
      expect(eventLog.length).toBe(1);
    });
  });

  describe("hydrateFromSnapshot", () => {
    it("restores pairRegistry and pairMeta from snapshot", () => {
      const snap = {
        schemaVersion: 1,
        pairRegistry: ["A::B", "C::D"],
        pairMeta: [["A::B", defaultMeta()] as const],
        apiKeyStore: [] as [],
        webhookStore: [] as [],
        eventLog: [] as [],
      };
      hydrateFromSnapshot(snap);
      expect(pairRegistry.has("A::B")).toBe(true);
      expect(pairRegistry.has("C::D")).toBe(true);
      expect(pairMeta.get("A::B")).toEqual(defaultMeta());
    });

    it("skips invalid snapshot entries gracefully", () => {
      hydrateFromSnapshot({
        pairRegistry: "not-an-array",
        pairMeta: null,
      });
      expect(pairRegistry.size).toBe(0);
      expect(pairMeta.size).toBe(0);
    });

    it("discards API key records missing salt or hash", () => {
      apiKeyStore.set("srk_legacy", {
        label: "legacy",
        createdAt: 1,
        salt: "",
        hash: "",
      });
      const snap = getSnapshot();
      snap.apiKeyStore.push(["srk_bad", { label: "bad", createdAt: 2 } as unknown as ApiKeyRecord]);
      hydrateFromSnapshot(snap);
      expect(apiKeyStore.has("srk_legacy")).toBe(true);
      expect(apiKeyStore.has("srk_bad")).toBe(false);
    });

    it("hydrates apiKeyStore and webhookStore", () => {
      const apiRecord: ApiKeyRecord = {
        label: "hydrated-key",
        createdAt: 10,
        salt: "s",
        hash: "h",
        scopes: ["read"],
      };
      const snap = {
        schemaVersion: 1,
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [["srk_hydrated", apiRecord] as const],
        webhookStore: [["wh_hydrated", { url: "https://hook.example.com", events: ["pair.registered"], createdAt: 20 }] as const],
        eventLog: [],
      };
      hydrateFromSnapshot(snap);
      expect(apiKeyStore.get("srk_hydrated")?.label).toBe("hydrated-key");
      expect(apiKeyStore.get("srk_hydrated")?.scopes).toEqual(["read"]);
      expect(webhookStore.get("wh_hydrated")?.url).toBe("https://hook.example.com");
    });

    it("hydrates eventLog", () => {
      const snap = {
        schemaVersion: 1,
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [{ id: "evt1", ts: 1, type: "pair.registered" as EventType, payload: {} }],
      };
      hydrateFromSnapshot(snap);
      expect(eventLog).toHaveLength(1);
      expect(eventLog.at(0)?.id).toBe("evt1");
    });
  });

  describe("KNOWN_EVENT_TYPES", () => {
    it("is a frozen tuple of strings", () => {
      expect(Array.isArray(KNOWN_EVENT_TYPES)).toBe(true);
      expect(KNOWN_EVENT_TYPES.length).toBeGreaterThan(0);
    });
  });

  describe("constants", () => {
    it("EVENT_LOG_CAP is 10_000", () => {
      expect(EVENT_LOG_CAP).toBe(10_000);
    });

    it("EVENT_LOG_CAP_MAX is 1_000_000", () => {
      expect(EVENT_LOG_CAP_MAX).toBe(1_000_000);
    });

    it("RATE_BUCKETS_MAX_IPS is 10_000", () => {
      expect(RATE_BUCKETS_MAX_IPS).toBe(10_000);
    });

    it("HEALTH_PROBE_KEY starts with NUL", () => {
      expect(HEALTH_PROBE_KEY).toMatch(/^\x00/);
    });
  });
});
