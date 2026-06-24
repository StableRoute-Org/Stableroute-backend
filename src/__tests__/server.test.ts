import http from "node:http";
import app from "../index";
import { createServer, registerSignalHandlers } from "../server";

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
