import { isIP } from "node:net";

/**
 * Validate that a URL host is safe for webhook delivery and does not target
 * loopback, link-local, or private IP networks (SSRF prevention).
 */
export const isSafeWebhookUrl = (urlString: string): boolean => {
  try {
    const url = new URL(urlString);
    let host = url.hostname.toLowerCase();
    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.slice(1, -1);
    }

    if (host === "localhost") return false;

    // Check if host is IP
    const ipType = isIP(host);
    if (ipType === 4) {
      // Check for loopback 127.x.x.x
      if (host.startsWith("127.")) return false;
      // Check for private / RFC 1918
      // 10.0.0.0/8
      if (host.startsWith("10.")) return false;
      // 172.16.0.0/12
      if (host.startsWith("172.")) {
        const parts = host.split(".");
        const second = Number(parts[1]);
        if (second >= 16 && second <= 31) return false;
      }
      // 192.168.0.0/16
      if (host.startsWith("192.168.")) return false;
      // 169.254.0.0/16 (link local)
      if (host.startsWith("169.254.")) return false;

      return true;
    } else if (ipType === 6) {
      // Check for loopback ::1
      if (host === "::1" || host === "0:0:0:0:0:0:0:1") return false;
      // Check for link-local fe80::
      if (host.startsWith("fe80:")) return false;
      // Check for unique-local fc00:: or fd00::
      if (host.startsWith("fc00:") || host.startsWith("fd00:")) return false;

      return true;
    }

    return true; // standard public hostnames
  } catch {
    return false;
  }
};
