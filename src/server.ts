import http from "node:http";
import type { Express } from "express";
import app, { hydrationPromise } from "./index";

// ---------------------------------------------------------------------------
// HTTP socket timeout helpers
// ---------------------------------------------------------------------------

/**
 * Parse a numeric timeout value from an environment variable.
 *
 * Returns `defaultValue` when the variable is absent, empty, non-numeric,
 * non-finite, non-integer, or non-positive — mirroring the safe-parsing
 * pattern used by {@link parseGraceMs}.
 *
 * @param envVar       - The name of the environment variable to read.
 * @param defaultValue - Fallback value (must be a positive integer).
 * @returns A positive integer timeout in milliseconds.
 */
export function parseTimeoutMs(envVar: string, defaultValue: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.floor(parsed);
}

/**
 * Read the HTTP keep-alive timeout from `KEEP_ALIVE_TIMEOUT_MS`.
 * Defaults to **5 000** ms (Node.js built-in default).
 */
export function parseKeepAliveTimeout(): number {
  return parseTimeoutMs("KEEP_ALIVE_TIMEOUT_MS", 5_000);
}

/**
 * Read the HTTP headers timeout from `HEADERS_TIMEOUT_MS`.
 * Defaults to **61 000** ms so that it comfortably exceeds the default
 * keep-alive timeout (5 s), avoiding spurious connection resets when a
 * fronting load balancer holds the connection open between requests.
 */
export function parseHeadersTimeout(): number {
  return parseTimeoutMs("HEADERS_TIMEOUT_MS", 61_000);
}

/**
 * Read the HTTP request timeout from `REQUEST_TIMEOUT_MS`.
 * Defaults to **300 000** ms (Node.js built-in default, 5 min).
 * Set to `0` to disable the request timeout entirely.
 */
export function parseRequestTimeout(): number {
  return parseTimeoutMs("REQUEST_TIMEOUT_MS", 300_000);
}

/**
 * Bind the Express app to a port and start listening.
 *
 * The port defaults to `process.env.PORT ?? 3001`, matching the previous
 * top-level behavior. Tests can pass an explicit port (e.g. `0` for an
 * ephemeral OS-assigned port) to start a throwaway server without colliding
 * with the production port.
 *
 * The returned `http.Server` has its **keepAliveTimeout**, **headersTimeout**,
 * and **requestTimeout** set from environment variables (see
 * `parseKeepAliveTimeout`, `parseHeadersTimeout`, and
 * `parseRequestTimeout`). A warning is emitted when `headersTimeout <=
 * keepAliveTimeout` because that combination can cause spurious connection
 * resets behind a load balancer.
 *
 * @returns the configured `http.Server`.
 */
export function createServer(
  application: Express = app,
  port: string | number = process.env.PORT ?? 3001,
): http.Server {
  const server = http.createServer(application);

  server.keepAliveTimeout = parseKeepAliveTimeout();
  server.headersTimeout = parseHeadersTimeout();
  server.requestTimeout = parseRequestTimeout();

  if (server.headersTimeout <= server.keepAliveTimeout) {
    console.warn(
      `HEADERS_TIMEOUT_MS (${server.headersTimeout}) should exceed ` +
      `KEEP_ALIVE_TIMEOUT_MS (${server.keepAliveTimeout}) to avoid ` +
      `spurious connection resets behind a load balancer.`,
    );
  }

  server.listen(port, () => {
    console.log(`StableRoute backend listening on http://localhost:${port}`);
  });

  return server;
}

/**
 * Parse the shutdown grace period from an environment variable.
 *
 * Reads `SHUTDOWN_GRACE_MS`. If the value is absent, non-numeric, not a
 * finite integer, or non-positive the default of `10_000` ms is returned,
 * making it safe to set the env var to an arbitrary string without crashing.
 *
 * @returns grace period in milliseconds (positive integer, default 10 000).
 */
export function parseGraceMs(): number {
  const raw = process.env.SHUTDOWN_GRACE_MS;
  if (raw === undefined || raw.trim() === "") return 10_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10_000;
  return Math.floor(parsed);
}

/** Injectable dependencies for {@link handleShutdown}. */
export interface ShutdownDeps {
  /** Called instead of `process.exit` so tests can intercept exit codes. */
  exit: (code: number) => void;
  /** Called instead of `setTimeout` so tests can control timer behaviour. */
  setTimeout: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Grace period in milliseconds before the forced-exit timer fires. */
  graceMs?: number;
}

/**
 * Perform a graceful drain of `server` and call `deps.exit` with the
 * appropriate code when done (or when the grace period expires).
 *
 * - Exits **0** when `server.close` completes without error (clean drain).
 * - Exits **1** when `server.close` calls back with an error.
 * - Exits **1** when the drain hangs longer than `graceMs` milliseconds.
 *
 * The forced-exit timer is `.unref()`'d so it never keeps the event loop
 * alive on its own in production.
 *
 * @param server  - The HTTP server to drain.
 * @param signal  - Signal name used in the log line (informational only).
 * @param deps    - Injectable overrides for `process.exit` and `setTimeout`.
 */
export function handleShutdown(
  server: http.Server,
  signal: string,
  deps: ShutdownDeps,
): void {
  const graceMs = deps.graceMs ?? parseGraceMs();
  console.log(`Received ${signal}, draining…`);

  server.close((err) => {
    if (err) {
      console.error("server.close error:", err);
      deps.exit(1);
      return;
    }
    deps.exit(0);
  });

  const timer = deps.setTimeout(() => {
    console.error(`Forced exit after ${graceMs}ms drain timeout`);
    deps.exit(1);
  }, graceMs);

  // In production the timer must not keep the process alive on its own.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * Wire SIGTERM/SIGINT to a graceful shutdown of the given server.
 *
 * On signal the server stops accepting connections (`server.close`) and exits
 * 0 once drained, or 1 on a close error. A configurable safety timer
 * (`.unref()`'d so it never keeps the event loop alive on its own) forces
 * exit 1 if draining hangs. The grace period is read from `SHUTDOWN_GRACE_MS`
 * (default 10 000 ms).
 */
export function registerSignalHandlers(server: http.Server): void {
  const productionDeps: ShutdownDeps = {
    exit: (code) => process.exit(code),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  process.on("SIGTERM", () =>
    handleShutdown(server, "SIGTERM", productionDeps),
  );
  process.on("SIGINT", () => handleShutdown(server, "SIGINT", productionDeps));
}

/**
 * Production entry point: start the server and register signal handlers.
 *
 * @returns the running `http.Server`.
 */
export async function start(): Promise<http.Server> {
  await hydrationPromise;
  const server = createServer();
  registerSignalHandlers(server);
  return server;
}

// Only start listening when run directly (`node dist/server.js`), not when
// imported by tests.
if (require.main === module) {
  void start();
}
