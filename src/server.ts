import http from "node:http";
import type { Express } from "express";
import app, { hydrationPromise } from "./index";
import { saveSnapshotImmediately } from "./stores";
import { logger } from "./logger";

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
  const server = application.listen(port, () => {
    console.log(`StableRoute backend listening on http://localhost:${port}`);
  });

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

  // Surface a fatal bind error (e.g. EADDRINUSE) and exit non-zero so a
  // process supervisor can restart us instead of running half-bound.
  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
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

/** Default timeout in milliseconds for the adapter flush during shutdown. */
const DEFAULT_FLUSH_TIMEOUT_MS = 5_000;

/**
 * Parse the adapter flush timeout from an environment variable.
 *
 * Reads `FLUSH_TIMEOUT_MS`. If the value is absent, non-numeric, not a
 * finite integer, or non-positive the default of `5_000` ms is returned.
 *
 * @returns flush timeout in milliseconds (positive integer, default 5 000).
 */
export function parseFlushTimeoutMs(): number {
  const raw = process.env.FLUSH_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_FLUSH_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FLUSH_TIMEOUT_MS;
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
  /**
   * Optional async flush of the persistence adapter before exit.
   * Called after the HTTP server drains and before process.exit.
   * A failure or timeout is logged but never prevents a clean (exit 0) shutdown.
   */
  flushAdapter?: () => Promise<void>;
  /**
   * Timeout in milliseconds for `flushAdapter`. Defaults to {@link DEFAULT_FLUSH_TIMEOUT_MS}.
   * Ignored when `flushAdapter` is not provided.
   */
  flushTimeoutMs?: number;
}

/**
 * Perform a graceful drain of `server` and call `deps.exit` with the
 * appropriate code when done (or when the grace period expires).
 *
 * - Exits **0** when `server.close` completes without error (clean drain).
 * - Exits **1** when `server.close` calls back with an error.
 * - Exits **1** when the drain hangs longer than `graceMs` milliseconds.
 *
 * After a successful HTTP drain, the optional {@link ShutdownDeps.flushAdapter}
 * is invoked with a bounded timeout. Flush failures or timeouts are logged but
 * never escalate to a non-zero exit — persistence is best-effort at shutdown.
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

  const timer = deps.setTimeout(() => {
    console.error(`Forced exit after ${graceMs}ms drain timeout`);
    deps.exit(1);
  }, graceMs);
  if (typeof timer.unref === "function") timer.unref();

  server.close((err) => {
    // Clear the forced-exit timer now that server.close resolved.
    clearTimeout(timer);

    if (err) {
      console.error("server.close error:", err);
      deps.exit(1);
      return;
    }

    // Flush the persistence adapter after a clean HTTP drain.
    if (deps.flushAdapter) {
      const flushTimeoutMs = deps.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
      const timeoutPromise = new Promise<void>((_, reject) => {
        const flushTimer = deps.setTimeout(() => {
          reject(new Error(`adapter flush timed out after ${flushTimeoutMs}ms`));
        }, flushTimeoutMs);
        if (typeof flushTimer.unref === "function") flushTimer.unref();
      });

      Promise.race([deps.flushAdapter(), timeoutPromise])
        .then(() => {
          logger.info("adapter flushed successfully during shutdown");
          deps.exit(0);
        })
        .catch((flushErr) => {
          logger.error({ err: flushErr }, "adapter flush failed during shutdown");
          deps.exit(0);
        });
    } else {
      deps.exit(0);
    }
  });
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
    flushAdapter: async () => {
      await saveSnapshotImmediately();
    },
    flushTimeoutMs: parseFlushTimeoutMs(),
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
