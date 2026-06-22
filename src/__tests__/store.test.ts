import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryAdapter,
  JsonFileAdapter,
  createStorageAdapterFromEnv,
  type StorageAdapter,
} from "../store/adapter";

type AdapterHarness = {
  adapter: StorageAdapter;
  reopen: () => StorageAdapter;
  persistsAcrossReopen: boolean;
  cleanup?: () => void;
};

const withHarness = (
  createHarness: () => AdapterHarness,
  test: (harness: AdapterHarness) => void
) => {
  const harness = createHarness();
  try {
    test(harness);
  } finally {
    harness.cleanup?.();
  }
};

const memoryHarness = (): AdapterHarness => ({
  adapter: new InMemoryAdapter(),
  reopen: () => new InMemoryAdapter(),
  persistsAcrossReopen: false,
});

const jsonHarness = (): AdapterHarness => {
  const dir = mkdtempSync(join(tmpdir(), "stableroute-store-"));
  const file = join(dir, "state.json");
  return {
    adapter: new JsonFileAdapter(file),
    reopen: () => new JsonFileAdapter(file),
    persistsAcrossReopen: true,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

const runStorageContract = (
  name: string,
  createHarness: () => AdapterHarness
) => {
  describe(name, () => {
    it("stores pairs and pair metadata", () => {
      withHarness(createHarness, ({ adapter }) => {
        expect(adapter.pairCount()).toBe(0);
        expect(adapter.addPair("USD::EUR")).toBe(true);
        expect(adapter.addPair("USD::EUR")).toBe(false);
        expect(adapter.pairCount()).toBe(1);
        expect(adapter.listPairs()).toEqual(["USD::EUR"]);
        expect(adapter.hasPair("USD::EUR")).toBe(true);
        expect(adapter.getPairMeta("USD::EUR")).toBeUndefined();

        adapter.setPairMeta("USD::EUR", {
          feeBps: 25,
          minAmount: "10",
          maxAmount: "1000",
          liquidity: "500",
        });
        const meta = adapter.getPairMeta("USD::EUR");
        expect(meta).toEqual({
          feeBps: 25,
          minAmount: "10",
          maxAmount: "1000",
          liquidity: "500",
        });

        if (meta) meta.feeBps = 99;
        expect(adapter.getPairMeta("USD::EUR")?.feeBps).toBe(25);

        expect(adapter.deletePair("USD::EUR")).toBe(true);
        expect(adapter.deletePair("USD::EUR")).toBe(false);
        expect(adapter.getPairMeta("USD::EUR")?.feeBps).toBe(25);
      });
    });

    it("stores API keys, webhooks, and events", () => {
      withHarness(createHarness, ({ adapter }) => {
        adapter.saveApiKey("srk_abcdef012345", { label: "primary", createdAt: 123 });
        expect(adapter.listApiKeys()).toEqual([
          {
            key: "srk_abcdef012345",
            record: { label: "primary", createdAt: 123 },
          },
        ]);
        expect(adapter.deleteApiKeyByPrefix("srk_abcd")).toBe(true);
        expect(adapter.deleteApiKeyByPrefix("srk_abcd")).toBe(false);

        adapter.saveWebhook("wh_1", {
          url: "https://example.com/hook",
          events: ["pair.registered"],
          createdAt: 456,
        });
        expect(adapter.hasWebhook("wh_1")).toBe(true);
        expect(adapter.listWebhooks()).toEqual([
          {
            id: "wh_1",
            record: {
              url: "https://example.com/hook",
              events: ["pair.registered"],
              createdAt: 456,
            },
          },
        ]);
        expect(adapter.deleteWebhook("wh_1")).toBe(true);
        expect(adapter.deleteWebhook("wh_1")).toBe(false);

        adapter.appendEvent({
          id: "evt_1",
          ts: 100,
          type: "pair.registered",
          payload: { source: "USD" },
        });
        adapter.appendEvent({
          id: "evt_2",
          ts: 200,
          type: "pair.unregistered",
          payload: { source: "USD" },
        });
        expect(adapter.listEvents(150, 10)).toEqual([
          {
            id: "evt_2",
            ts: 200,
            type: "pair.unregistered",
            payload: { source: "USD" },
          },
        ]);
        expect(adapter.listEvents(0, 1)).toHaveLength(1);
      });
    });

    it("reports storage probe success", () => {
      withHarness(createHarness, ({ adapter }) => {
        expect(adapter.probe()).toBe(true);
      });
    });

    it("uses the expected reopen behavior", () => {
      withHarness(createHarness, ({ adapter, reopen, persistsAcrossReopen }) => {
        adapter.addPair("USD::EUR");
        adapter.setPairMeta("USD::EUR", {
          feeBps: 40,
          minAmount: "1",
          maxAmount: "100",
          liquidity: "50",
        });
        adapter.setPairMeta("GONE::PAIR", {
          feeBps: 5,
          minAmount: "2",
          maxAmount: "200",
          liquidity: "25",
        });
        adapter.saveApiKey("srk_persisted", { label: "durable", createdAt: 1 });
        adapter.saveWebhook("wh_persisted", {
          url: "https://example.com/persisted",
          events: ["pair.registered"],
          createdAt: 2,
        });
        adapter.appendEvent({
          id: "evt_persisted",
          ts: 3,
          type: "pair.registered",
          payload: { source: "USD", destination: "EUR" },
        });

        const reopened = reopen();
        if (persistsAcrossReopen) {
          expect(reopened.hasPair("USD::EUR")).toBe(true);
          expect(reopened.getPairMeta("USD::EUR")?.feeBps).toBe(40);
          expect(reopened.getPairMeta("GONE::PAIR")?.feeBps).toBe(5);
          expect(reopened.listApiKeys()).toHaveLength(1);
          expect(reopened.listWebhooks()).toHaveLength(1);
          expect(reopened.listEvents(0, 10)).toHaveLength(1);
        } else {
          expect(reopened.hasPair("USD::EUR")).toBe(false);
          expect(reopened.getPairMeta("USD::EUR")).toBeUndefined();
          expect(reopened.listApiKeys()).toHaveLength(0);
          expect(reopened.listWebhooks()).toHaveLength(0);
          expect(reopened.listEvents(0, 10)).toHaveLength(0);
        }
      });
    });
  });
};

describe("storage adapters", () => {
  runStorageContract("InMemoryAdapter", memoryHarness);
  runStorageContract("JsonFileAdapter", jsonHarness);

  it("selects adapters from environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "stableroute-store-env-"));
    try {
      const file = join(dir, "state.json");
      expect(createStorageAdapterFromEnv({ STORAGE_BACKEND: "memory" })).toBeInstanceOf(InMemoryAdapter);
      expect(
        createStorageAdapterFromEnv({ STORAGE_BACKEND: "json", STORAGE_FILE: file })
      ).toBeInstanceOf(JsonFileAdapter);
      expect(() => createStorageAdapterFromEnv({ STORAGE_BACKEND: "sqlite" })).toThrow(
        /Unsupported STORAGE_BACKEND/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
