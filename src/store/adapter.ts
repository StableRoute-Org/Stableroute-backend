import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type PairMeta = {
  feeBps: number;
  minAmount: string;
  maxAmount: string;
  liquidity: string;
};

export type AppEvent = {
  id: string;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};

export type ApiKeyRecord = {
  label: string;
  createdAt: number;
};

export type WebhookRecord = {
  url: string;
  events: string[];
  createdAt: number;
};

export const defaultPairMeta = (): PairMeta => ({
  feeBps: 0,
  minAmount: "0",
  maxAmount: "0",
  liquidity: "0",
});

const DEFAULT_EVENT_LOG_CAP = 10_000;

type StorageSnapshot = {
  version: 1;
  pairs: string[];
  pairMeta: Record<string, PairMeta>;
  apiKeys: Record<string, ApiKeyRecord>;
  webhooks: Record<string, WebhookRecord>;
  events: AppEvent[];
};

const emptySnapshot = (): StorageSnapshot => ({
  version: 1,
  pairs: [],
  pairMeta: {},
  apiKeys: {},
  webhooks: {},
  events: [],
});

const cloneMeta = (meta: PairMeta): PairMeta => ({ ...meta });
const cloneApiKey = (record: ApiKeyRecord): ApiKeyRecord => ({ ...record });
const cloneWebhook = (record: WebhookRecord): WebhookRecord => ({
  ...record,
  events: [...record.events],
});
const cloneEvent = (event: AppEvent): AppEvent => ({
  ...event,
  payload: { ...event.payload },
});

/**
 * Pluggable storage contract for StableRoute registry state.
 *
 * Implementations own pairs, per-pair metadata, API keys, webhooks, and
 * audit events. Methods are synchronous to match the current Express request
 * path and keep response behavior unchanged while storage remains local.
 */
export interface StorageAdapter {
  probe(): boolean;

  listPairs(): string[];
  pairCount(): number;
  hasPair(key: string): boolean;
  addPair(key: string): boolean;
  deletePair(key: string): boolean;

  getPairMeta(key: string): PairMeta | undefined;
  setPairMeta(key: string, meta: PairMeta): void;
  deletePairMeta(key: string): void;

  listApiKeys(): Array<{ key: string; record: ApiKeyRecord }>;
  saveApiKey(key: string, record: ApiKeyRecord): void;
  deleteApiKeyByPrefix(prefix: string): boolean;

  listWebhooks(): Array<{ id: string; record: WebhookRecord }>;
  hasWebhook(id: string): boolean;
  saveWebhook(id: string, record: WebhookRecord): void;
  deleteWebhook(id: string): boolean;

  appendEvent(event: AppEvent): void;
  listEvents(since: number, limit: number): AppEvent[];
}

/**
 * Process-local storage adapter preserving the original in-memory behavior.
 */
export class InMemoryAdapter implements StorageAdapter {
  protected readonly pairs = new Set<string>();
  protected readonly pairMeta = new Map<string, PairMeta>();
  protected readonly apiKeys = new Map<string, ApiKeyRecord>();
  protected readonly webhooks = new Map<string, WebhookRecord>();
  protected readonly events: AppEvent[] = [];

  constructor(private readonly eventLogCap = DEFAULT_EVENT_LOG_CAP) {}

  probe(): boolean {
    const key = `__probe_${Date.now()}_${Math.random()}`;
    this.setPairMeta(key, defaultPairMeta());
    const readback = this.getPairMeta(key);
    this.deletePairMeta(key);
    return readback !== undefined;
  }

  listPairs(): string[] {
    return Array.from(this.pairs);
  }

  pairCount(): number {
    return this.pairs.size;
  }

  hasPair(key: string): boolean {
    return this.pairs.has(key);
  }

  addPair(key: string): boolean {
    const isNew = !this.pairs.has(key);
    this.pairs.add(key);
    return isNew;
  }

  deletePair(key: string): boolean {
    return this.pairs.delete(key);
  }

  getPairMeta(key: string): PairMeta | undefined {
    const meta = this.pairMeta.get(key);
    return meta ? cloneMeta(meta) : undefined;
  }

  setPairMeta(key: string, meta: PairMeta): void {
    this.pairMeta.set(key, cloneMeta(meta));
  }

  deletePairMeta(key: string): void {
    this.pairMeta.delete(key);
  }

  listApiKeys(): Array<{ key: string; record: ApiKeyRecord }> {
    return Array.from(this.apiKeys.entries()).map(([key, record]) => ({
      key,
      record: cloneApiKey(record),
    }));
  }

  saveApiKey(key: string, record: ApiKeyRecord): void {
    this.apiKeys.set(key, cloneApiKey(record));
  }

  deleteApiKeyByPrefix(prefix: string): boolean {
    const key = Array.from(this.apiKeys.keys()).find((candidate) => candidate.slice(0, 8) === prefix);
    if (!key) return false;
    this.apiKeys.delete(key);
    return true;
  }

  listWebhooks(): Array<{ id: string; record: WebhookRecord }> {
    return Array.from(this.webhooks.entries()).map(([id, record]) => ({
      id,
      record: cloneWebhook(record),
    }));
  }

  hasWebhook(id: string): boolean {
    return this.webhooks.has(id);
  }

  saveWebhook(id: string, record: WebhookRecord): void {
    this.webhooks.set(id, cloneWebhook(record));
  }

  deleteWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  appendEvent(event: AppEvent): void {
    this.events.push(cloneEvent(event));
    if (this.events.length > this.eventLogCap) this.events.shift();
  }

  listEvents(since: number, limit: number): AppEvent[] {
    return this.events.filter((event) => event.ts >= since).slice(-limit).map(cloneEvent);
  }
}

/**
 * JSON-file storage adapter for local durable deployments.
 *
 * The adapter loads its snapshot during construction and writes the full
 * snapshot after every mutation, giving simple restart persistence without a
 * database dependency.
 */
export class JsonFileAdapter extends InMemoryAdapter {
  constructor(private readonly filePath: string, eventLogCap = DEFAULT_EVENT_LOG_CAP) {
    super(eventLogCap);
    this.load();
  }

  override addPair(key: string): boolean {
    const result = super.addPair(key);
    this.persist();
    return result;
  }

  override deletePair(key: string): boolean {
    const result = super.deletePair(key);
    this.persist();
    return result;
  }

  override setPairMeta(key: string, meta: PairMeta): void {
    super.setPairMeta(key, meta);
    this.persist();
  }

  override deletePairMeta(key: string): void {
    super.deletePairMeta(key);
    this.persist();
  }

  override saveApiKey(key: string, record: ApiKeyRecord): void {
    super.saveApiKey(key, record);
    this.persist();
  }

  override deleteApiKeyByPrefix(prefix: string): boolean {
    const result = super.deleteApiKeyByPrefix(prefix);
    if (result) this.persist();
    return result;
  }

  override saveWebhook(id: string, record: WebhookRecord): void {
    super.saveWebhook(id, record);
    this.persist();
  }

  override deleteWebhook(id: string): boolean {
    const result = super.deleteWebhook(id);
    if (result) this.persist();
    return result;
  }

  override appendEvent(event: AppEvent): void {
    super.appendEvent(event);
    this.persist();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const snapshot = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StorageSnapshot>;
    for (const key of snapshot.pairs ?? []) super.addPair(key);
    for (const [key, meta] of Object.entries(snapshot.pairMeta ?? {})) super.setPairMeta(key, meta);
    for (const [key, record] of Object.entries(snapshot.apiKeys ?? {})) super.saveApiKey(key, record);
    for (const [id, record] of Object.entries(snapshot.webhooks ?? {})) super.saveWebhook(id, record);
    for (const event of snapshot.events ?? []) super.appendEvent(event);
  }

  private persist(): void {
    const snapshot = this.snapshot();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(tmpPath, this.filePath);
  }

  private snapshot(): StorageSnapshot {
    const pairMeta: Record<string, PairMeta> = {};
    for (const [key, meta] of this.pairMeta.entries()) {
      pairMeta[key] = cloneMeta(meta);
    }

    return {
      ...emptySnapshot(),
      pairs: this.listPairs(),
      pairMeta,
      apiKeys: Object.fromEntries(
        this.listApiKeys().map(({ key, record }) => [key, record])
      ),
      webhooks: Object.fromEntries(
        this.listWebhooks().map(({ id, record }) => [id, record])
      ),
      events: this.listEvents(0, DEFAULT_EVENT_LOG_CAP),
    };
  }
}

export const createStorageAdapterFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): StorageAdapter => {
  const backend = env.STORAGE_BACKEND ?? "memory";
  if (backend === "memory") return new InMemoryAdapter();
  if (backend === "json") return new JsonFileAdapter(env.STORAGE_FILE ?? "stableroute-storage.json");
  throw new Error(`Unsupported STORAGE_BACKEND: ${backend}`);
};
