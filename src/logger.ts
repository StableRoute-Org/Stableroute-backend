import pino from "pino";

/**
 * Application logger. It is silent in tests, respects LOG_LEVEL elsewhere,
 * and redacts sensitive headers if future call sites include request metadata.
 */
export const logger = pino({
  enabled: process.env.NODE_ENV !== "test",
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "headers.authorization",
      "headers.x-api-key",
      "req.headers.authorization",
      "req.headers.x-api-key",
    ],
    censor: "[redacted]",
  },
});
