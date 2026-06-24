import http from "node:http";
import type { Express } from "express";
import app from "./index";

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
 * Wire SIGTERM/SIGINT to a graceful shutdown of the given server.
 *
 * On signal the server stops accepting connections (`server.close`) and exits
 * 0 once drained, or 1 on a close error. A 10s safety timer (`.unref()`'d so it
 * never keeps the event loop alive on its own) forces exit 1 if draining hangs.
 */
export function registerSignalHandlers(server: http.Server): void {
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, draining…`);
    server.close((err) => {
      if (err) {
        console.error("server.close error:", err);
        process.exit(1);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced exit after 10s drain timeout");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Production entry point: start the server and register signal handlers.
 *
 * @returns the running `http.Server`.
 */
export function start(): http.Server {
  const server = createServer();
  registerSignalHandlers(server);
  return server;
}

// Only start listening when run directly (`node dist/server.js`), not when
// imported by tests.
if (require.main === module) {
  start();
}
