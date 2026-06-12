import app from "./index";

const PORT = process.env.PORT ?? 3001;

const server = app.listen(PORT, () => {
  console.log(`StableRoute backend listening on http://localhost:${PORT}`);
});

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
