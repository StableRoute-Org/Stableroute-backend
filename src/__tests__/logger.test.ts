import { LOGGER_REDACT_PATHS, buildLogger } from "../logger";

describe("logger", () => {
  it("is disabled under NODE_ENV=test", () => {
    const testLogger = buildLogger({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

    expect(testLogger.isLevelEnabled("info")).toBe(false);
  });

  it("uses LOG_LEVEL outside test mode", () => {
    const debugLogger = buildLogger({ NODE_ENV: "production", LOG_LEVEL: "debug" } as NodeJS.ProcessEnv);

    expect(debugLogger.level).toBe("debug");
    expect(debugLogger.isLevelEnabled("debug")).toBe(true);
  });

  it("redacts credential-bearing header fields", () => {
    expect(LOGGER_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "headers.authorization",
        "headers.x-api-key",
        "req.headers.authorization",
        "req.headers.x-api-key",
      ])
    );
  });
});
