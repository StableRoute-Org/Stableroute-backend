import http from "node:http";
import app from "../index";
import {
  createServer,
  registerSignalHandlers,
  handleShutdown,
  parseGraceMs,
  start,
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
// createServer — PORT resolution
// ---------------------------------------------------------------------------

describe("createServer — PORT resolution", () => {
  const ORIGINAL_PORT = process.env.PORT;
  let listenSpy: jest.SpyInstance;

  afterEach(() => {
    listenSpy?.mockRestore();
    if (ORIGINAL_PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = ORIGINAL_PORT;
    }
  });

  it("uses default port 3001 when PORT is unset", () => {
    delete process.env.PORT;
    listenSpy = jest.spyOn(app, "listen").mockReturnValue(
      { on: () => {} } as unknown as http.Server,
    );
    createServer();
    expect(listenSpy).toHaveBeenCalledWith(3001, expect.any(Function));
  });

  it("uses a numeric PORT from environment", () => {
    process.env.PORT = "4000";
    listenSpy = jest.spyOn(app, "listen").mockReturnValue(
      { on: () => {} } as unknown as http.Server,
    );
    createServer();
    // process.env always returns strings
    expect(listenSpy).toHaveBeenCalledWith("4000", expect.any(Function));
  });

  it("passes a non-numeric PORT string through to listen", () => {
    process.env.PORT = "abc";
    listenSpy = jest.spyOn(app, "listen").mockReturnValue(
      { on: () => {} } as unknown as http.Server,
    );
    createServer();
    expect(listenSpy).toHaveBeenCalledWith("abc", expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// createServer — listen callback
// ---------------------------------------------------------------------------

describe("createServer — listen callback", () => {
  it("logs the resolved port exactly once on listen", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    const server = createServer(app, 0);
    await new Promise<void>((resolve) => server.on("listening", resolve));

    // createServer's callback logs the raw port parameter (0), not the
    // OS-assigned ephemeral port from server.address().
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "StableRoute backend listening on http://localhost:0",
    );

    logSpy.mockRestore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

// ---------------------------------------------------------------------------
// createServer — listen error
// ---------------------------------------------------------------------------

describe("createServer — listen error", () => {
  it("logs and exits non-zero when binding fails with EADDRINUSE", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((_code) => undefined as never);
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // Start a server on an ephemeral port so we know a port that's in use.
    const server1 = createServer(app, 0);
    await new Promise<void>((resolve) => server1.on("listening", resolve));
    const addr = server1.address() as { port: number };
    const usedPort = addr.port;

    // Try to start another server on the same port — triggers EADDRINUSE.
    const server2 = createServer(app, usedPort);
    await new Promise<void>((resolve) => server2.on("error", () => resolve()));

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
    await new Promise<void>((resolve) => server1.close(() => resolve()));
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
    if (!server.listening) {
      await new Promise<void>((resolve) => server.on("listening", resolve));
    }

    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "stableroute-backend",
    });
  });

  it("closes cleanly with no hanging handles", async () => {
    server = createServer(app, 0);
    if (!server.listening) {
      await new Promise<void>((resolve) => server.on("listening", resolve));
    }

    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);

    // close() resolving without error means no hanging connections.
    await expect(
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
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

  it("starts on ephemeral port, responds to /health, and shuts down with an unref'd timer", async () => {
    server = createServer(app, 0);
    if (!server.listening) {
      await new Promise<void>((resolve) => server.on("listening", resolve));
    }

    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "stableroute-backend",
    });

    let exitCode: number | null = null;
    let timerUnrefCalled = false;

    const mockTimer = {
      unref() {
        timerUnrefCalled = true;
      },
    } as unknown as NodeJS.Timeout;

    const deps: ShutdownDeps = {
      exit: (code) => {
        exitCode = code;
      },
      setTimeout: (_fn, _ms) => {
        return mockTimer;
      },
      graceMs: 100,
    };

    handleShutdown(server, "SIGTERM", deps);

    // Wait for the close callback to fire and resolve
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    expect(timerUnrefCalled).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("start() starts the server with process.env.PORT override", async () => {
    const originalPort = process.env.PORT;
    process.env.PORT = "0";

    let startedServer: http.Server | null = null;
    try {
      startedServer = await start();
      expect(startedServer).not.toBeNull();
      if (startedServer) {
        expect(startedServer.listening).toBe(true);
        const addr = startedServer.address();
        const port = addr && typeof addr === "object" ? addr.port : 0;
        expect(port).toBeGreaterThan(0);
      }
    } finally {
      process.env.PORT = originalPort;
      const s = startedServer;
      if (s && s.listening) {
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  });

  it("registerSignalHandlers responds to SIGTERM by starting graceful shutdown", async () => {
    jest.useFakeTimers();

    const server = createServer(app, 0);
    if (!server.listening) {
      await new Promise<void>((resolve) => server.on("listening", resolve));
    }

    registerSignalHandlers(server);

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((_code) => {
      return undefined as never;
    });

    process.emit("SIGTERM");

    // Wait for the close callback to trigger process.exit(0)
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();

    jest.restoreAllMocks();
    jest.useRealTimers();
  });
});
