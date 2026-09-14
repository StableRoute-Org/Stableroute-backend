import { describe, it, expect, beforeEach } from "vitest";
import { eventLog, resetStores } from "../stores";
import { auditLog } from "../utils/audit";

describe("auditLog", () => {
  beforeEach(() => {
    resetStores();
  });

  it("creates an audit event", () => {
    auditLog("pair.registered", { source: "XLM", dest: "USDC" });
    expect(eventLog.length).toBe(1);
    expect(eventLog[0].type).toBe("pair.registered");
  });

  it("includes details in payload", () => {
    auditLog("apikey.created", { keyId: "test-key" });
    expect(eventLog[0].payload).toMatchObject({ keyId: "test-key" });
  });

  it("does not throw on unknown event type", () => {
    expect(() => auditLog("unknown.event" as any)).not.toThrow();
  });
});
