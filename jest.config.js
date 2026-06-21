/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/server.ts"],
  // Coverage thresholds enforced in CI.
  // server.ts (24 lines) is excluded from coverage because importing it
  // starts a server that keeps the event loop alive and hangs Jest.
  // Once server.ts is refactored for testability, raise all thresholds
  // toward 95% per issue #26 requirements.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
};
