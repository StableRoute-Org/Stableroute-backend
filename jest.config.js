/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: false }],
  },
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  globals: {
    "ts-jest": {
      diagnostics: false,
    },
  },
  // Coverage thresholds enforced in CI.
  // server.ts is now refactored into side-effect-free, exported functions
  // (createServer / registerSignalHandlers / start) and the actual listen is
  // guarded by `require.main === module`, so it can be imported and exercised
  // by src/__tests__/server.test.ts without hanging Jest. The signal-handler
  // shutdown body still runs `process.exit`, so it is intentionally not
  // invoked in tests, which is why server.ts branch coverage stays partial.
  // Thresholds are set at 92 % statements and 85 % branches today, moving closer
  // to the 95 % target.
  coverageThreshold: {
    global: {
      statements: 92,
      branches: 85,
      functions: 94,
      lines: 92,
    },
  },
};
