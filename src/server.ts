import http from "node:http";
import type { Express } from "express";
import app, { hydrationPromise } from "./index";

/**
 * Bind the Express app to a port and start listening.
 *
 * The port defaults to `process.env.PORT ?? 3001`, matching the previous
 * top-level behavior. Tests can pass an explicit port (e.g. `0` for an
 * ephemeral OS-assigned port) to start a throwaway server without colliding
 * with the production port.
 *
 * @returns the `http.Server` returned by `app.listen`.
 */
export function createServer(
  application: Express = app,
  port: string | number = process.env.PORT ?? 3001
): http.Server {
  return application.listen(port, () => {
    console.log(`StableRoute backend listening on http://localhost:${port}`);
  });
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
  deps: ShutdownDeps
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
  process.on("SIGTERM", () => handleShutdown(server, "SIGTERM", productionDeps));
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
