import http from "node:http";
import app from "../index";
import {
  createServer,
  registerSignalHandlers,
  handleShutdown,
  parseGraceMs,
  type ShutdownDeps,
} from "../server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake `http.Server` whose `close` callback we control manually. */
function makeFakeServer() {
  let closeCallback: ((err?: Error) => void) | null = null;
  const server = {
    close(cb: (err?: Error) => void) {
      closeCallback = cb;
    },
    // Trigger the close callback from the test.
    triggerClose(err?: Error) {
      closeCallback?.(err);
    },
  } as unknown as http.Server & { triggerClose(err?: Error): void };
  return server;
}

/** Build injectable deps for `handleShutdown` that never really exit or wait. */
function makeDeps(graceMs = 10_000) {
  const exitCodes: number[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const deps: ShutdownDeps = {
    exit: (code) => exitCodes.push(code),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      // Return a stub with unref so handleShutdown won't throw.
      return { unref: () => {} } as unknown as NodeJS.Timeout;
    },
    graceMs,
  };
  return { deps, exitCodes, timers };
}

// ---------------------------------------------------------------------------
// parseGraceMs
// ---------------------------------------------------------------------------

describe("parseGraceMs", () => {
  const originalEnv = process.env.SHUTDOWN_GRACE_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SHUTDOWN_GRACE_MS;
    } else {
      process.env.SHUTDOWN_GRACE_MS = originalEnv;
    }
  });

  it("returns 10 000 when SHUTDOWN_GRACE_MS is unset", () => {
    delete process.env.SHUTDOWN_GRACE_MS;
    expect(parseGraceMs()).toBe(10_000);
  });

  it("returns the parsed value for a valid positive integer string", () => {
    process.env.SHUTDOWN_GRACE_MS = "5000";
    expect(parseGraceMs()).toBe(5_000);
  });

  it("falls back to 10 000 for a non-numeric string", () => {
    process.env.SHUTDOWN_GRACE_MS = "banana";
    expect(parseGraceMs()).toBe(10_000);
  });

  it("falls back to 10 000 for zero", () => {
    process.env.SHUTDOWN_GRACE_MS = "0";
    expect(parseGraceMs()).toBe(10_000);
  });

  it("falls back to 10 000 for a negative value", () => {
    process.env.SHUTDOWN_GRACE_MS = "-500";
    expect(parseGraceMs()).toBe(10_000);
  });

  it("falls back to 10 000 for an empty string", () => {
    process.env.SHUTDOWN_GRACE_MS = "  ";
    expect(parseGraceMs()).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// handleShutdown — clean drain (exit 0)
// ---------------------------------------------------------------------------

describe("handleShutdown — clean drain", () => {
  it("calls exit(0) when server.close completes without error", () => {
    const server = makeFakeServer();
    const { deps, exitCodes, timers } = makeDeps();

    handleShutdown(server, "SIGTERM", deps);

    // Timer should have been armed but not fired yet.
    expect(timers).toHaveLength(1);
    expect(exitCodes).toHaveLength(0);

    // Simulate a clean drain.
    server.triggerClose();

    expect(exitCodes).toEqual([0]);
  });

  it("arms the safety timer with the configured grace period", () => {
    const server = makeFakeServer();
    const { deps, timers } = makeDeps(3_000);

    handleShutdown(server, "SIGINT", deps);

    expect(timers[0].ms).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// handleShutdown — close error (exit 1)
// ---------------------------------------------------------------------------

describe("handleShutdown — close error", () => {
  it("calls exit(1) when server.close returns an error", () => {
    const server = makeFakeServer();
    const { deps, exitCodes } = makeDeps();

    handleShutdown(server, "SIGTERM", deps);
    server.triggerClose(new Error("listener not running"));

    expect(exitCodes).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// handleShutdown — forced drain timeout (exit 1)
// ---------------------------------------------------------------------------

describe("handleShutdown — forced drain timeout", () => {
  it("calls exit(1) when the grace timer fires before server.close resolves", () => {
    const server = makeFakeServer();
    const { deps, exitCodes, timers } = makeDeps(500);

    handleShutdown(server, "SIGTERM", deps);

    // Timer armed but server.close never resolved — simulate timeout firing.
    expect(timers).toHaveLength(1);
    timers[0].fn();

    expect(exitCodes).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// Server startup (existing suite — preserved)
// ---------------------------------------------------------------------------

describe("Server startup", () => {
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    // Avoid leaking signal listeners across the suite.
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  it("createServer(app, 0) starts on an ephemeral port and serves /health", async () => {
    server = createServer(app, 0);
    await new Promise<void>((resolve) => server.on("listening", resolve));

    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", service: "stableroute-backend" });
  });

  it("closes cleanly with no hanging handles", async () => {
    server = createServer(app, 0);
    await new Promise<void>((resolve) => server.on("listening", resolve));

    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);

    // close() resolving without error means no hanging connections.
    await expect(
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
    ).resolves.toBeUndefined();
  });

  it("registerSignalHandlers wires SIGTERM and SIGINT listeners", () => {
    server = createServer(app, 0);

    const before = {
      term: process.listenerCount("SIGTERM"),
      int: process.listenerCount("SIGINT"),
    };
    registerSignalHandlers(server);

    expect(process.listenerCount("SIGTERM")).toBe(before.term + 1);
    expect(process.listenerCount("SIGINT")).toBe(before.int + 1);
    // NOTE: we never emit the real signal — handlers call process.exit.
  });
});
