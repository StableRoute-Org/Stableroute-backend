/**
 * Resolve the client's IP address from request headers or remote connection address.
 *
 * If X-Forwarded-For is present, uses the first IP listed.
 */
export const resolveClientIp = (
  forwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined
): string => {
  if (forwardedFor) {
    const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const first = raw.split(",")[0].trim();
    if (first) return first;
  }
  return remoteAddress ?? "unknown";
};
