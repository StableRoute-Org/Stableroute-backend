/**
 * Tests for the pluggable storage adapter.
 *
 * The same behavioural suite is run against both {@link InMemoryAdapter} and
 * {@link JsonFileAdapter} to ensure the two implementations are equivalent.
 * An additional section for {@link JsonFileAdapter} covers durability: state
 * written by one instance is visible after creating a new instance that reads
 * the same file (simulating a process restart).
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { InMemoryAdapter, JsonFileAdapter, createAdapter } from "../store/adapter";
import type { StorageAdapter } from "../store/adapter";
import type { PairMeta, ApiKeyRecord, WebhookRecord, AppEvent, EventType } from "../stores";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tmpFile = (): string => join(tmpdir(), `sr-test-${randomUUID()}.json`);

const sampleMeta = (): PairMeta => ({
  feeBps: 10,
  minAmount: "100",
  maxAmount: "1000",
  liquidity: "5000",
  enabled: true,
  rate: "1.0",
});

const sampleKey = (): ApiKeyRecord => ({ label: "test-key", createdAt: 1784200000000 });

const sampleWebhook = (): WebhookRecord => ({
  url: "https://example.com/hook",
  events: ["pair.registered"],
  createdAt: 1784200000000,
});

const sampleEvent = (type: EventType = "pair.registered"): AppEvent => ({
  id: randomUUID(),
  ts: Date.now(),
  type,
  payload: { source: "USDC", destination: "EURC" },
});

// ─── Shared suite ─────────────────────────────────────────────────────────────

function runAdapterSuite(label: string, factory: () => StorageAdapter): void {
  describe(label, () => {
    let adapter: StorageAdapter;

    beforeEach(() => {
      adapter = factory();
    });

    afterEach(() => {
      adapter.clear();
    });

    // Pairs
    describe("pairs", () => {
      it("starts empty", () => {
        expect(adapter.pairsSize()).toBe(0);
        expect(adapter.pairsHas("USDC::EURC")).toBe(false);
      });

      it("adds and checks a pair", () => {
        adapter.pairsAdd("USDC::EURC");
        expect(adapter.pairsHas("USDC::EURC")).toBe(true);
        expect(adapter.pairsSize()).toBe(1);
      });

      it("pairsAll returns all registered keys", () => {
        adapter.pairsAdd("USDC::EURC");
        adapter.pairsAdd("XLM::USDC");
        expect(adapter.pairsAll().size).toBe(2);
        expect(adapter.pairsAll().has("XLM::USDC")).toBe(true);
      });

      it("deletes a pair and returns true", () => {
        adapter.pairsAdd("USDC::EURC");
        expect(adapter.pairsDelete("USDC::EURC")).toBe(true);
        expect(adapter.pairsHas("USDC::EURC")).toBe(false);
      });

      it("delete returns false for absent pair", () => {
        expect(adapter.pairsDelete("NOPE::NOPE")).toBe(false);
      });
    });

    // Pair metadata
    describe("pair metadata", () => {
      it("returns undefined for unknown key", () => {
        expect(adapter.metaGet("USDC::EURC")).toBeUndefined();
      });

      it("stores and retrieves metadata", () => {
        adapter.metaSet("USDC::EURC", sampleMeta());
        expect(adapter.metaGet("USDC::EURC")).toEqual(sampleMeta());
      });

      it("deletes metadata and returns true", () => {
        adapter.metaSet("USDC::EURC", sampleMeta());
        expect(adapter.metaDelete("USDC::EURC")).toBe(true);
        expect(adapter.metaGet("USDC::EURC")).toBeUndefined();
      });

      it("metaDelete returns false for absent key", () => {
        expect(adapter.metaDelete("NOPE::NOPE")).toBe(false);
      });
    });

    // API keys
    describe("api keys", () => {
      it("starts empty", () => {
        expect(adapter.keysSize()).toBe(0);
      });

      it("stores and retrieves a key record", () => {
        adapter.keysSet("srk_abc", sampleKey());
        expect(adapter.keysGet("srk_abc")).toEqual(sampleKey());
        expect(adapter.keysSize()).toBe(1);
      });

      it("keysAll returns all entries", () => {
        adapter.keysSet("srk_aaa", sampleKey());
        adapter.keysSet("srk_bbb", { label: "b", createdAt: 1 });
        expect(adapter.keysAll().size).toBe(2);
      });

      it("deletes a key and returns true", () => {
        adapter.keysSet("srk_abc", sampleKey());
        expect(adapter.keysDelete("srk_abc")).toBe(true);
        expect(adapter.keysGet("srk_abc")).toBeUndefined();
      });

      it("keysDelete returns false for absent key", () => {
        expect(adapter.keysDelete("srk_missing")).toBe(false);
      });
    });

    // Webhooks
    describe("webhooks", () => {
      it("starts empty", () => {
        expect(adapter.webhooksSize()).toBe(0);
      });

      it("stores and retrieves a webhook", () => {
        adapter.webhooksSet("wh_1", sampleWebhook());
        expect(adapter.webhooksGet("wh_1")).toEqual(sampleWebhook());
        expect(adapter.webhooksSize()).toBe(1);
      });

      it("webhooksAll returns all entries", () => {
        adapter.webhooksSet("wh_1", sampleWebhook());
        adapter.webhooksSet("wh_2", { url: "https://b.com", events: ["*"], createdAt: 1 });
        expect(adapter.webhooksAll().size).toBe(2);
      });

      it("deletes a webhook and returns true", () => {
        adapter.webhooksSet("wh_1", sampleWebhook());
        expect(adapter.webhooksDelete("wh_1")).toBe(true);
        expect(adapter.webhooksGet("wh_1")).toBeUndefined();
      });

      it("webhooksDelete returns false for absent id", () => {
        expect(adapter.webhooksDelete("wh_missing")).toBe(false);
      });
    });

    // Events
    describe("events", () => {
      it("starts with empty log", () => {
        expect(adapter.eventsGet()).toHaveLength(0);
      });

      it("appends events", () => {
        adapter.eventsAppend(sampleEvent("pair.registered"));
        adapter.eventsAppend(sampleEvent("apikey.created"));
        expect(adapter.eventsGet()).toHaveLength(2);
      });

      it("eventsTrim removes oldest entries to fit cap", () => {
        for (let i = 0; i < 10; i++) adapter.eventsAppend(sampleEvent());
        adapter.eventsTrim(5);
        expect(adapter.eventsGet()).toHaveLength(5);
      });

      it("eventsTrim is a no-op when log is within cap", () => {
        adapter.eventsAppend(sampleEvent());
        adapter.eventsTrim(100);
        expect(adapter.eventsGet()).toHaveLength(1);
      });
    });

    // clear
    describe("clear", () => {
      it("removes all data across every collection", () => {
        adapter.pairsAdd("USDC::EURC");
        adapter.metaSet("USDC::EURC", sampleMeta());
        adapter.keysSet("srk_abc", sampleKey());
        adapter.webhooksSet("wh_1", sampleWebhook());
        adapter.eventsAppend(sampleEvent());
        adapter.clear();
        expect(adapter.pairsSize()).toBe(0);
        expect(adapter.metaGet("USDC::EURC")).toBeUndefined();
        expect(adapter.keysSize()).toBe(0);
        expect(adapter.webhooksSize()).toBe(0);
        expect(adapter.eventsGet()).toHaveLength(0);
      });
    });
  });
}

// ─── Run suite against both adapters ─────────────────────────────────────────

runAdapterSuite("InMemoryAdapter", () => new InMemoryAdapter());

describe("JsonFileAdapter", () => {
  let filePath: string;

  beforeEach(() => {
    filePath = tmpFile();
  });

  afterEach(() => {
    if (existsSync(filePath)) unlinkSync(filePath);
  });

  runAdapterSuite("behavioural suite", () => new JsonFileAdapter(filePath));

  it("persists data across re-open (simulates process restart)", () => {
    const a = new JsonFileAdapter(filePath);
    a.pairsAdd("USDC::EURC");
    a.metaSet("USDC::EURC", sampleMeta());
    a.keysSet("srk_abc", sampleKey());
    a.webhooksSet("wh_1", sampleWebhook());
    a.eventsAppend(sampleEvent("pair.registered"));

    // Second instance reads the same file
    const b = new JsonFileAdapter(filePath);
    expect(b.pairsHas("USDC::EURC")).toBe(true);
    expect(b.metaGet("USDC::EURC")).toEqual(sampleMeta());
    expect(b.keysGet("srk_abc")).toEqual(sampleKey());
    expect(b.webhooksGet("wh_1")).toEqual(sampleWebhook());
    expect(b.eventsGet()).toHaveLength(1);
    expect(b.eventsGet()[0].type).toBe("pair.registered");
  });

  it("starts with empty state when file does not exist", () => {
    const a = new JsonFileAdapter(tmpFile()); // intentionally no cleanup — file won't exist
    expect(a.pairsSize()).toBe(0);
    expect(a.keysSize()).toBe(0);
    expect(a.webhooksSize()).toBe(0);
    expect(a.eventsGet()).toHaveLength(0);
  });

  it("recovers from corrupted JSON file gracefully", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(filePath, "{ not valid json ]", "utf8");
    const a = new JsonFileAdapter(filePath);
    expect(a.pairsSize()).toBe(0);
  });
});

// ─── createAdapter factory ────────────────────────────────────────────────────

describe("createAdapter", () => {
  const originalBackend = process.env.STORAGE_BACKEND;
  const originalFile = process.env.STORAGE_FILE;

  afterEach(() => {
    if (originalBackend === undefined) {
      delete process.env.STORAGE_BACKEND;
    } else {
      process.env.STORAGE_BACKEND = originalBackend;
    }
    if (originalFile === undefined) {
      delete process.env.STORAGE_FILE;
    } else {
      process.env.STORAGE_FILE = originalFile;
    }
  });

  it("returns InMemoryAdapter when STORAGE_BACKEND is unset", () => {
    delete process.env.STORAGE_BACKEND;
    expect(createAdapter()).toBeInstanceOf(InMemoryAdapter);
  });

  it("returns InMemoryAdapter when STORAGE_BACKEND=memory", () => {
    process.env.STORAGE_BACKEND = "memory";
    expect(createAdapter()).toBeInstanceOf(InMemoryAdapter);
  });

  it("returns JsonFileAdapter when STORAGE_BACKEND=json-file", () => {
    const f = tmpFile();
    process.env.STORAGE_BACKEND = "json-file";
    process.env.STORAGE_FILE = f;
    const a = createAdapter();
    expect(a).toBeInstanceOf(JsonFileAdapter);
    if (existsSync(f)) unlinkSync(f);
  });
});
