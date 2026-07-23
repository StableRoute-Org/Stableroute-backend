import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENT_SCHEMA_VERSION,
  getStoreAdapter,
  InMemoryStoreAdapter,
  JsonFileStoreAdapter,
} from "../persistence";
import {
  pairRegistry,
  pairMeta,
  apiKeyStore,
  webhookStore,
  eventLog,
  resetStores,
  getSnapshot,
  hydrateFromSnapshot,
  saveSnapshotImmediately,
  setHydrating,
} from "../stores";
import fs from "node:fs";

const TEST_SNAP_PATH = join(__dirname, "test_snapshot_run.json");

describe("Persistence Layer", () => {
  beforeEach(() => {
    // Reset stores and ensure no leftover files
    resetStores();
    delete process.env.PERSIST_PATH;
    if (existsSync(TEST_SNAP_PATH)) {
      try {
        unlinkSync(TEST_SNAP_PATH);
      } catch {}
    }
    const tempFile = `${TEST_SNAP_PATH}.tmp`;
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch {}
    }
  });

  afterEach(() => {
    delete process.env.PERSIST_PATH;
    if (existsSync(TEST_SNAP_PATH)) {
      try {
        unlinkSync(TEST_SNAP_PATH);
      } catch {}
    }
    const tempFile = `${TEST_SNAP_PATH}.tmp`;
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch {}
    }
  });

  describe("Adapter Selection", () => {
    it("returns InMemoryStoreAdapter when PERSIST_PATH is unset", () => {
      const adapter = getStoreAdapter();
      expect(adapter).toBeInstanceOf(InMemoryStoreAdapter);
    });

    it("returns JsonFileStoreAdapter when PERSIST_PATH is set", () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      const adapter = getStoreAdapter();
      expect(adapter).toBeInstanceOf(JsonFileStoreAdapter);
    });
  });

  describe("InMemoryStoreAdapter", () => {
    it("returns null on load", async () => {
      const adapter = new InMemoryStoreAdapter();
      const res = await adapter.load();
      expect(res).toBeNull();
    });

    it("does not throw on save", () => {
      const adapter = new InMemoryStoreAdapter();
      const snap = getSnapshot();
      expect(() => adapter.save(snap)).not.toThrow();
    });
  });

  describe("JsonFileStoreAdapter", () => {
    it("returns null on load if file does not exist", () => {
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      expect(adapter.load()).toBeNull();
    });

    it("returns null and handles error on corrupt JSON", () => {
      writeFileSync(TEST_SNAP_PATH, "{invalid json", "utf8");
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      expect(adapter.load()).toBeNull();
    });

    it("returns null if JSON is valid but not a valid snapshot shape", () => {
      writeFileSync(
        TEST_SNAP_PATH,
        JSON.stringify({ randomField: true }),
        "utf8",
      );
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      expect(adapter.load()).toBeNull();
    });

    it("saves and loads snapshot successfully (round-trip)", async () => {
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);

      // Mutate stores to have some test data
      pairRegistry.add("USDC::EURC");
      pairMeta.set("USDC::EURC", {
        feeBps: 10,
        minAmount: "1",
        maxAmount: "100",
        liquidity: "1000",
        enabled: true,
        rate: "1.08",
      });
      apiKeyStore.set("srk_test", {
        label: "test key",
        createdAt: 12345,
        scopes: ["write"],
        salt: "test-salt",
        hash: "test-hash",
      });
      webhookStore.set("wh_test", {
        url: "https://example.com/webhook",
        events: ["pair.registered"],
        createdAt: 67890,
      });
      eventLog.push({
        id: "evt_1",
        ts: 9999,
        type: "pair.registered",
        payload: { source: "USDC", dest: "EURC" },
      });

      const snapBefore = getSnapshot();
      await adapter.save(snapBefore);

      // Verify file actually exists
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);

      // Check file permissions (owner-only on non-Windows)
      if (process.platform !== "win32") {
        const stat = fs.statSync(TEST_SNAP_PATH);
        expect(stat.mode & 0o777).toBe(0o600);
      }

      // Reset stores to empty
      resetStores();
      expect(pairRegistry.size).toBe(0);

      // Hydrate from file
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      hydrateFromSnapshot(loaded);

      // Assert data restored
      expect(pairRegistry.has("USDC::EURC")).toBe(true);
      expect(pairMeta.get("USDC::EURC")).toEqual({
        feeBps: 10,
        minAmount: "1",
        maxAmount: "100",
        liquidity: "1000",
        enabled: true,
        rate: "1.08",
      });
      expect(apiKeyStore.get("srk_test")).toEqual({
        label: "test key",
        createdAt: 12345,
        scopes: ["write"],
        salt: "test-salt",
        hash: "test-hash",
      });
      expect(webhookStore.get("wh_test")).toEqual({
        url: "https://example.com/webhook",
        events: ["pair.registered"],
        createdAt: 67890,
      });
      expect(eventLog).toHaveLength(1);
      expect(eventLog[0]).toEqual({
        id: "evt_1",
        ts: 9999,
        type: "pair.registered",
        payload: { source: "USDC", dest: "EURC" },
      });
    });

    it("invalidates pre-migration apiKeyStore entries lacking salt/hash on hydration", () => {
      // Legacy snapshots stored the *raw* API key as the map key, in a record
      // that predates the salt/hash fields -- exactly the recoverable
      // material this store format eliminates. Hydration must discard such
      // entries rather than trust (or silently re-hash) a value that may
      // already have been read out of a leaked snapshot.
      const legacySnapshot = {
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [
          [
            "srk_legacyrawkeyvalue00000000000",
            { label: "legacy", createdAt: 1, scopes: ["pairs:write"] },
          ],
        ],
        webhookStore: [],
        eventLog: [],
      };

      hydrateFromSnapshot(legacySnapshot);

      expect(apiKeyStore.size).toBe(0);
    });

    it("retains post-migration apiKeyStore entries carrying salt/hash on hydration", () => {
      const snapshot = {
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [
          [
            "srk_abcd",
            {
              label: "current",
              createdAt: 1,
              scopes: [],
              salt: "s",
              hash: "h",
            },
          ],
        ],
        webhookStore: [],
        eventLog: [],
      };

      hydrateFromSnapshot(snapshot);

      expect(apiKeyStore.get("srk_abcd")).toEqual({
        label: "current",
        createdAt: 1,
        scopes: [],
        salt: "s",
        hash: "h",
      });
    });

    it("invalidates only the legacy entries in a mixed pre/post-migration snapshot", () => {
      const mixedSnapshot = {
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [
          ["srk_legacy1", { label: "legacy", createdAt: 1, scopes: [] }],
          [
            "srk_currnt",
            {
              label: "current",
              createdAt: 2,
              scopes: [],
              salt: "s",
              hash: "h",
            },
          ],
        ],
        webhookStore: [],
        eventLog: [],
      };

      hydrateFromSnapshot(mixedSnapshot);

      expect(apiKeyStore.has("srk_legacy1")).toBe(false);
      expect(apiKeyStore.get("srk_currnt")).toEqual({
        label: "current",
        createdAt: 2,
        scopes: [],
        salt: "s",
        hash: "h",
      });
      expect(apiKeyStore.size).toBe(1);
    });

    it("verifies atomic save (temp file created first)", async () => {
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const tempPath = `${TEST_SNAP_PATH}.tmp`;

      // Spy on openSync to capture when the temp file is opened for writing
      const originalOpenSync = fs.openSync;
      let tempFileExistedDuringWrite = false;

      jest.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
        const fd = originalOpenSync(path, flags, mode);
        if (path === tempPath) {
          tempFileExistedDuringWrite = existsSync(tempPath);
        }
        return fd;
      });

      const snap = getSnapshot();
      await adapter.save(snap);

      expect(tempFileExistedDuringWrite).toBe(true);
      expect(existsSync(tempPath)).toBe(false); // Cleaned up/renamed after save
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);

      jest.restoreAllMocks();
    });
  });

  describe("Schema Versioning & Migration", () => {
    it("exports CURRENT_SCHEMA_VERSION as 1", () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(1);
    });

    it("saved snapshot includes schemaVersion field", () => {
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const snap = getSnapshot();
      adapter.save(snap);

      const raw = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(raw).toHaveProperty("schemaVersion", CURRENT_SCHEMA_VERSION);
    });

    it("loads a snapshot with matching schemaVersion", () => {
      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      pairRegistry.add("BTC::USDT");
      adapter.save(getSnapshot());

      resetStores();
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(loaded!.pairRegistry).toContain("BTC::USDT");
    });

    it("refuses snapshot with newer schemaVersion", () => {
      const futureSnapshot = {
        schemaVersion: CURRENT_SCHEMA_VERSION + 1,
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [],
      };
      writeFileSync(TEST_SNAP_PATH, JSON.stringify(futureSnapshot), "utf8");

      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      expect(adapter.load()).toBeNull();
    });

    it("auto-migrates a v0 snapshot (no schemaVersion) and backfills pairMeta defaults", () => {
      const v0Snapshot = {
        pairRegistry: ["USDC::EURC"],
        pairMeta: [
          [
            "USDC::EURC",
            { feeBps: 10, minAmount: "1", maxAmount: "100", liquidity: "1000" },
          ],
        ],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [],
      };
      writeFileSync(TEST_SNAP_PATH, JSON.stringify(v0Snapshot), "utf8");

      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      // Version should be bumped
      expect(loaded!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      // Backfilled fields
      expect(loaded!.pairMeta[0][1].enabled).toBe(true);
      expect(loaded!.pairMeta[0][1].rate).toBe("1.0");
      // Original data preserved
      expect(loaded!.pairMeta[0][1].feeBps).toBe(10);
      expect(loaded!.pairRegistry).toContain("USDC::EURC");
    });

    it("v0 migration preserves existing enabled and rate when present", () => {
      const v0Snapshot = {
        pairRegistry: [],
        pairMeta: [
          [
            "XRP::USDC",
            {
              feeBps: 5,
              minAmount: "10",
              maxAmount: "1000",
              liquidity: "50000",
              enabled: false,
              rate: "0.5",
            },
          ],
        ],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [],
      };
      writeFileSync(TEST_SNAP_PATH, JSON.stringify(v0Snapshot), "utf8");

      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.pairMeta[0][1].enabled).toBe(false);
      expect(loaded!.pairMeta[0][1].rate).toBe("0.5");
    });

    it("v0 migration with partial pairMeta fields backfills only missing", () => {
      const v0Snapshot = {
        pairRegistry: [],
        pairMeta: [
          [
            "ETH::BTC",
            {
              feeBps: 25,
              minAmount: "0.01",
              maxAmount: "100",
              liquidity: "200",
              enabled: false,
            },
          ],
          [
            "BTC::USDT",
            {
              feeBps: 10,
              minAmount: "0.001",
              maxAmount: "50",
              liquidity: "10000",
              rate: "60000",
            },
          ],
        ],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [],
      };
      writeFileSync(TEST_SNAP_PATH, JSON.stringify(v0Snapshot), "utf8");

      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();

      const meta0 = loaded!.pairMeta[0][1];
      expect(meta0.enabled).toBe(false);
      expect(meta0.rate).toBe("1.0"); // backfilled

      const meta1 = loaded!.pairMeta[1][1];
      expect(meta1.enabled).toBe(true); // backfilled
      expect(meta1.rate).toBe("60000"); // preserved
    });

    it("v0 snapshot with no pairs migrates cleanly", () => {
      const v0Snapshot = {
        pairRegistry: [],
        pairMeta: [],
        apiKeyStore: [],
        webhookStore: [],
        eventLog: [],
      };
      writeFileSync(TEST_SNAP_PATH, JSON.stringify(v0Snapshot), "utf8");

      const adapter = new JsonFileStoreAdapter(TEST_SNAP_PATH);
      const loaded = adapter.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(loaded!.pairMeta).toHaveLength(0);
    });
  });

  describe("Auto-save Integration (Mutation Hooking)", () => {
    it("does not auto-save during hydration", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      setHydrating(true);

      pairRegistry.add("BTC::USDT");
      // Wait to see if save was triggered (debounced)
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(existsSync(TEST_SNAP_PATH)).toBe(false);
      setHydrating(false);
    });

    it("auto-saves on pairRegistry mutations", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      pairRegistry.add("BTC::USDT");

      // Verify debounce: it shouldn't exist immediately
      expect(existsSync(TEST_SNAP_PATH)).toBe(false);

      // Wait for debounce timer (100ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.pairRegistry).toContain("BTC::USDT");
    });

    it("auto-saves on pairMeta mutations", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      pairMeta.set("BTC::USDT", {
        feeBps: 5,
        minAmount: "0.1",
        maxAmount: "10",
        liquidity: "50",
        enabled: true,
        rate: "60000",
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.pairMeta).toHaveLength(1);
      expect(data.pairMeta[0][0]).toBe("BTC::USDT");
    });

    it("auto-saves on apiKeyStore mutations", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      apiKeyStore.set("srk_key1", {
        label: "label1",
        createdAt: 1,
        salt: "s",
        hash: "h",
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.apiKeyStore).toHaveLength(1);
      expect(data.apiKeyStore[0][0]).toBe("srk_key1");
    });

    it("auto-saves on webhookStore mutations", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      webhookStore.set("wh_1", {
        url: "http://test",
        events: [],
        createdAt: 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.webhookStore).toHaveLength(1);
      expect(data.webhookStore[0][0]).toBe("wh_1");
    });

    it("auto-saves on eventLog mutations", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      eventLog.push({ id: "1", ts: 1, type: "pair.registered", payload: {} });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.eventLog).toHaveLength(1);
      expect(data.eventLog[0].id).toBe("1");
    });

    it("debounces multiple rapid mutations to a single save", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;
      let savesCount = 0;

      // Mock save to count executions
      const adapter = getStoreAdapter();
      jest.spyOn(adapter, "save").mockImplementation(() => {
        savesCount++;
      });

      // Override active adapter in memory so trigger uses the spy
      jest
        .spyOn(require("../persistence"), "getStoreAdapter")
        .mockReturnValue(adapter);

      pairRegistry.add("A::B");
      pairRegistry.add("C::D");
      apiKeyStore.set("srk_1", {
        label: "1",
        createdAt: 1,
        salt: "s",
        hash: "h",
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(savesCount).toBe(1);

      jest.restoreAllMocks();
    });

    it("allows immediate save with saveSnapshotImmediately", async () => {
      process.env.PERSIST_PATH = TEST_SNAP_PATH;

      pairRegistry.add("BTC::USDT");
      await saveSnapshotImmediately();

      // Should exist immediately after calling saveSnapshotImmediately
      expect(existsSync(TEST_SNAP_PATH)).toBe(true);
      const data = JSON.parse(readFileSync(TEST_SNAP_PATH, "utf8"));
      expect(data.pairRegistry).toContain("BTC::USDT");
    });
  });
});
