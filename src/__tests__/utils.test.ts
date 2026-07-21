import { resolveClientIp } from "../utils/clientIp";
import { isSafeWebhookUrl } from "../utils/webhookUrl";

describe("resolveClientIp", () => {
  it("resolves from X-Forwarded-For string (first IP)", () => {
    expect(resolveClientIp("1.2.3.4, 5.6.7.8", undefined)).toBe("1.2.3.4");
  });

  it("resolves from X-Forwarded-For array (first IP of first string)", () => {
    expect(resolveClientIp(["9.10.11.12, 13.14.15.16"], undefined)).toBe("9.10.11.12");
  });

  it("falls back to remoteAddress when X-Forwarded-For is absent", () => {
    expect(resolveClientIp(undefined, "172.217.16.14")).toBe("172.217.16.14");
  });

  it("returns 'unknown' when both parameters are absent", () => {
    expect(resolveClientIp(undefined, undefined)).toBe("unknown");
  });

  it("handles blank / empty string in X-Forwarded-For by falling back to remoteAddress", () => {
    expect(resolveClientIp("", "1.1.1.1")).toBe("1.1.1.1");
  });
});

describe("isSafeWebhookUrl", () => {
  describe("IPv4", () => {
    it("allows public IPv4 addresses", () => {
      expect(isSafeWebhookUrl("http://8.8.8.8")).toBe(true);
      expect(isSafeWebhookUrl("https://1.1.1.1/path")).toBe(true);
    });

    it("rejects loopback and private IPv4 ranges", () => {
      expect(isSafeWebhookUrl("http://127.0.0.1")).toBe(false);
      expect(isSafeWebhookUrl("http://127.255.255.255")).toBe(false);
      expect(isSafeWebhookUrl("http://10.0.0.1")).toBe(false);
      expect(isSafeWebhookUrl("http://172.16.0.1")).toBe(false);
      expect(isSafeWebhookUrl("http://172.31.255.255")).toBe(false);
      expect(isSafeWebhookUrl("http://192.168.1.100")).toBe(false);
      expect(isSafeWebhookUrl("http://169.254.1.1")).toBe(false);
    });

    it("allows IPv4 addresses just outside private ranges", () => {
      expect(isSafeWebhookUrl("http://172.15.255.255")).toBe(true);
      expect(isSafeWebhookUrl("http://172.32.0.1")).toBe(true);
    });
  });

  describe("IPv6", () => {
    it("allows public IPv6 addresses", () => {
      expect(isSafeWebhookUrl("http://[2001:db8::1]")).toBe(true);
    });

    it("rejects loopback, link-local, and unique-local IPv6 addresses", () => {
      expect(isSafeWebhookUrl("http://[::1]")).toBe(false);
      expect(isSafeWebhookUrl("http://[0:0:0:0:0:0:0:1]")).toBe(false);
      expect(isSafeWebhookUrl("http://[fe80::1]")).toBe(false);
      expect(isSafeWebhookUrl("http://[fc00::1]")).toBe(false);
      expect(isSafeWebhookUrl("http://[fd00::1]")).toBe(false);
    });
  });

  describe("Hostnames", () => {
    it("allows public hostnames", () => {
      expect(isSafeWebhookUrl("https://example.com")).toBe(true);
      expect(isSafeWebhookUrl("https://api.github.com/webhooks")).toBe(true);
    });

    it("rejects localhost", () => {
      expect(isSafeWebhookUrl("http://localhost")).toBe(false);
      expect(isSafeWebhookUrl("http://LOCALHOST:8080")).toBe(false);
    });
  });

  describe("Edge cases", () => {
    it("rejects invalid/malformed URLs", () => {
      expect(isSafeWebhookUrl("not-a-url")).toBe(false);
      expect(isSafeWebhookUrl("http://")).toBe(false);
      expect(isSafeWebhookUrl("")).toBe(false);
    });
  });
});
