import fs from "node:fs";
import path from "node:path";

describe(".env.example & README.md Configuration Reference", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const envExamplePath = path.join(rootDir, ".env.example");
  const readmePath = path.join(rootDir, "README.md");

  const EXPECTED_ENV_VARS = [
    "PORT",
    "NODE_ENV",
    "LOG_LEVEL",
    "ADMIN_TOKEN",
    "CORS_ALLOWED_ORIGINS",
    "TRUST_PROXY",
    "ALLOW_UNREGISTERED_QUOTES",
    "STORAGE_BACKEND",
    "STORAGE_FILE",
    "PERSIST_PATH",
    "PAUSE_STATE_FILE",
    "REQUEST_TIMEOUT_MS",
    "KEEP_ALIVE_TIMEOUT_MS",
    "HEADERS_TIMEOUT_MS",
    "IDEMPOTENCY_TTL_MS",
    "IDEMPOTENCY_CACHE_MAX",
    "SHUTDOWN_GRACE_MS",
    "FLUSH_TIMEOUT_MS",
    "GIT_COMMIT",
    "BUILD_TIME",
  ] as const;

  it("verifies .env.example exists in the repository root", () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it("parses .env.example into key-value pairs without syntax errors", () => {
    const content = fs.readFileSync(envExamplePath, "utf-8");
    const lines = content.split("\n");
    const parsedKeys: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
      expect(match).not.toBeNull();
      if (match) {
        parsedKeys.push(match[1]);
      }
    }

    expect(parsedKeys.sort()).toEqual([...EXPECTED_ENV_VARS].sort());
  });

  it("contains no sensitive real secrets or production tokens", () => {
    const content = fs.readFileSync(envExamplePath, "utf-8");
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]+/);
    expect(content).not.toMatch(/sk_live_[A-Za-z0-9]+/);
    expect(content).not.toMatch(/AWS_SECRET_ACCESS_KEY/i);
    expect(content).not.toContain("super-secret-production-key");
  });

  it("verifies every environment variable is documented in README.md", () => {
    const readmeContent = fs.readFileSync(readmePath, "utf-8");
    for (const envVar of EXPECTED_ENV_VARS) {
      expect(readmeContent).toContain(`\`${envVar}\``);
    }
  });
});
