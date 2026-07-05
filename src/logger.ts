import pino, { type Logger } from "pino";

export const LOGGER_REDACT_PATHS = [
  "headers.authorization",
  "headers.Authorization",
  "headers.x-api-key",
  "headers.X-Api-Key",
  "req.headers.authorization",
  "req.headers.Authorization",
  "req.headers.x-api-key",
  "req.headers.X-Api-Key",
];

/**
 * Build the application logger.
 *
 * Logs are disabled under NODE_ENV=test so Jest output stays clean. Runtime
 * deployments can tune verbosity with LOG_LEVEL. Redaction is configured for
 * common credential-bearing header paths in case future log call sites include
 * request metadata.
 */
export const buildLogger = (env: NodeJS.ProcessEnv = process.env): Logger =>
  pino({
    enabled: env.NODE_ENV !== "test",
    level: env.LOG_LEVEL ?? "info",
    redact: {
      paths: LOGGER_REDACT_PATHS,
      censor: "[redacted]",
    },
  });

export const logger = buildLogger();
