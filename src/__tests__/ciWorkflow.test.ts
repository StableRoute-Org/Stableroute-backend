import { execSync } from "node:child_process";
import path from "path";
import * as yaml from "js-yaml";

jest.mock("node:child_process");
jest.mock("node:fs", () => {
  const actual: typeof import("node:fs") = jest.requireActual("node:fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

const mockedExecSync = execSync as jest.Mock;

import {
  loadAllowlist,
  parseAuditOutput,
  filterVulnerabilities,
  runNpmAudit,
  checkDependencies,
} from "../ci/audit";
import type { AllowlistEntry, AuditResult, Vulnerability } from "../ci/audit";

interface BuildStep {
  run?: string;
  uses?: string;
  with?: Record<string, string>;
}

interface CiWorkflowJob {
  steps: BuildStep[];
  if?: string;
  needs?: string[];
}

interface CiWorkflow {
  jobs: Record<string, CiWorkflowJob>;
}

const realFs: typeof import("node:fs") = jest.requireActual("node:fs");

function makeVuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "GHSA-test-xxxx-xxxx",
    packageName: "test-pkg",
    severity: "high",
    title: "Test advisory",
    url: "https://github.com/advisories/GHSA-test-xxxx-xxxx",
    ...overrides,
  };
}

function makeAuditResult(vulns: Vulnerability[] = []): AuditResult {
  const high = vulns.filter((v) => v.severity === "high").length;
  const critical = vulns.filter((v) => v.severity === "critical").length;
  return {
    vulnerabilities: vulns,
    metadata: { totalCount: vulns.length, highCount: high, criticalCount: critical },
  };
}

describe("CI workflow YAML", () => {
  const ciPath = path.resolve(__dirname, "../../.github/workflows/ci.yml");
  let ciDoc: CiWorkflow;

  beforeAll(() => {
    const raw = realFs.readFileSync(ciPath, "utf-8");
    ciDoc = yaml.load(raw) as CiWorkflow;
  });

  it("parses as a valid YAML document", () => {
    expect(ciDoc).toBeTruthy();
  });

  it("has a dependency-audit job", () => {
    const jobs = ciDoc.jobs;
    expect(jobs).toHaveProperty("dependency-audit");
    const steps = jobs["dependency-audit"].steps.map((s) => s.run).filter(Boolean);
    expect(steps).toContain("node scripts/audit-deps.js");
  });

  it("has a dependency-review job for pull requests", () => {
    const jobs = ciDoc.jobs;
    expect(jobs).toHaveProperty("dependency-review");
    expect(jobs["dependency-review"].if).toBe("github.event_name == 'pull_request'");
    const uses = jobs["dependency-review"].steps.map((s) => s.uses).filter(Boolean);
    expect(uses.some((u: string) => u.startsWith("actions/dependency-review-action"))).toBe(true);
  });

  it("build-test depends on dependency-audit and validate-openapi", () => {
    const jobs = ciDoc.jobs;
    expect(jobs["build-test"].needs).toContain("dependency-audit");
    expect(jobs["build-test"].needs).toContain("validate-openapi");
  });

  it("dependency-review has fail-on-severity: high", () => {
    const jobs = ciDoc.jobs;
    const reviewStep = jobs["dependency-review"].steps.find(
      (s) => s.uses && s.uses.startsWith("actions/dependency-review-action")
    );
    expect(reviewStep!.with!["fail-on-severity"]).toBe("high");
  });
});

describe("loadAllowlist", () => {
  let mockExistsSync: jest.Mock;
  let mockReadFileSync: jest.Mock;

  beforeEach(() => {
    mockExistsSync = require("node:fs").existsSync;
    mockReadFileSync = require("node:fs").readFileSync;
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("returns empty array when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadAllowlist("/nonexistent/path")).toEqual([]);
  });

  it("parses valid allowlist entries", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { id: "GHSA-1111-2222-3333", reason: "No fix available", expires: "2099-01-01" },
        { id: "12345", reason: "Under review", expires: "2099-06-01" },
      ])
    );
    const result = loadAllowlist("/some/path");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("GHSA-1111-2222-3333");
    expect(result[1].id).toBe("12345");
  });

  it("returns empty array for empty allowlist", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("[]");
    expect(loadAllowlist("/some/path")).toEqual([]);
  });

  it("throws when allowlist is not an array", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"not":"an array"}');
    expect(() => loadAllowlist("/some/path")).toThrow("Allowlist must be a JSON array");
  });

  it("throws when allowlist entry is missing id", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ reason: "no id here", expires: "2099-01-01" }])
    );
    expect(() => loadAllowlist("/some/path")).toThrow("missing 'id' field");
  });

  it("filters out expired entries", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { id: "GHSA-valid", reason: "Still open", expires: "2099-01-01" },
        { id: "GHSA-expired", reason: "Expired", expires: "2020-01-01" },
      ])
    );
    const result = loadAllowlist("/some/path");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("GHSA-valid");
  });

  it("throws on malformed JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{invalid");
    expect(() => loadAllowlist("/some/path")).toThrow(SyntaxError);
  });

  it("throws when entry id is not a string", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ id: 12345, reason: "numeric id", expires: "2099-01-01" }])
    );
    expect(() => loadAllowlist("/some/path")).toThrow("missing 'id' field");
  });

  it("includes entry without expires field (not expired)", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ id: "GHSA-no-expires", reason: "Missing expires" }])
    );
    const result = loadAllowlist("/some/path");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("GHSA-no-expires");
  });
});

describe("parseAuditOutput", () => {
  it("returns empty result for empty vulnerabilities", () => {
    const result = parseAuditOutput('{"vulnerabilities":{}}');
    expect(result.vulnerabilities).toEqual([]);
    expect(result.metadata.totalCount).toBe(0);
  });

  it("returns empty result when vulnerabilities key is missing", () => {
    const result = parseAuditOutput("{}");
    expect(result.vulnerabilities).toEqual([]);
  });

  it("parses advisory objects from npm audit output", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        lodash: {
          name: "lodash",
          severity: "high",
          via: [
            {
              source: 1091234,
              name: "lodash",
              dependency: "lodash",
              title: "Prototype Pollution in lodash",
              url: "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx",
              severity: "high",
              cwe: ["CWE-1321"],
              range: ">=4.17.21",
            },
          ],
          range: ">=4.17.21",
          fixAvailable: false,
        },
      },
      metadata: {
        vulnerabilities: { high: 1, critical: 0, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0]).toMatchObject({
      id: "GHSA-xxxx-xxxx-xxxx",
      packageName: "lodash",
      severity: "high",
      title: "Prototype Pollution in lodash",
    });
    expect(result.metadata.highCount).toBe(1);
    expect(result.metadata.criticalCount).toBe(0);
  });

  it("falls back to source id when no GHSA url", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        foo: {
          name: "foo",
          severity: "critical",
          via: [
            {
              source: 42,
              name: "foo",
              title: "Critical vuln",
              severity: "critical",
            },
          ],
        },
      },
      metadata: {
        vulnerabilities: { critical: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].id).toBe("42");
    expect(result.vulnerabilities[0].severity).toBe("critical");
  });

  it("ignores string via entries and parses object entries", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        bar: {
          name: "bar",
          severity: "moderate",
          via: [
            "moderate-advisory-name",
            { source: 99, name: "bar", title: "Real vuln", severity: "moderate" },
          ],
        },
      },
      metadata: {
        vulnerabilities: { moderate: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].id).toBe("99");
  });

  it("returns empty when via array is missing", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        baz: { name: "baz", severity: "low" },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toEqual([]);
  });

  it("handles empty metadata gracefully", () => {
    const input = JSON.stringify({ vulnerabilities: {} });
    const result = parseAuditOutput(input);
    expect(result.metadata.totalCount).toBe(0);
    expect(result.metadata.highCount).toBe(0);
    expect(result.metadata.criticalCount).toBe(0);
  });

  it("skips advisory objects without source or url", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        a: {
          name: "a",
          severity: "high",
          via: [{ title: "No id info" }],
        },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toEqual([]);
  });

  it("extracts GHSA from url when source is absent", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        foo: {
          name: "foo",
          severity: "high",
          via: [
            {
              url: "https://github.com/advisories/GHSA-abc-def-1234",
              title: "No source field",
              severity: "high",
            },
          ],
        },
      },
      metadata: {
        vulnerabilities: { high: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].id).toBe("GHSA-abc-def-1234");
  });

  it("falls back to package-level severity when advisory severity is missing", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        foo: {
          name: "foo",
          severity: "critical",
          via: [
            {
              source: 100,
              title: "No severity on advisory",
            },
          ],
        },
      },
      metadata: {
        vulnerabilities: { critical: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].severity).toBe("critical");
  });

  it("defaults to high severity when neither advisory nor package level has severity", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        foo: {
          name: "foo",
          via: [
            {
              source: 101,
              title: "No severity at all",
            },
          ],
        },
      },
      metadata: {
        vulnerabilities: { total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].severity).toBe("high");
  });

  it("uses Unknown advisory when title is missing", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        x: {
          name: "x",
          severity: "high",
          via: [
            { source: 200, url: "https://github.com/advisories/GHSA-xxx-yyy-zzzz" },
          ],
        },
      },
      metadata: {
        vulnerabilities: { high: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].title).toBe("Unknown advisory");
  });

  it("skips advisory with non-GHSA url and no source", () => {
    const input = JSON.stringify({
      vulnerabilities: {
        y: {
          name: "y",
          severity: "high",
          via: [
            { url: "https://example.com/not-a-ghsa", title: "No GHSA" },
          ],
        },
      },
      metadata: {
        vulnerabilities: { high: 1, total: 1 },
      },
    });
    const result = parseAuditOutput(input);
    expect(result.vulnerabilities).toHaveLength(0);
  });
});

describe("filterVulnerabilities", () => {
  it("passes when no vulnerabilities exist", () => {
    const result = filterVulnerabilities(makeAuditResult(), []);
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.allowed).toEqual([]);
  });

  it("fails when vulnerabilities are not in allowlist", () => {
    const vulns = [makeVuln({ id: "GHSA-danger" })];
    const result = filterVulnerabilities(makeAuditResult(vulns), []);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.allowed).toHaveLength(0);
  });

  it("passes when all vulnerabilities are allowlisted", () => {
    const vulns = [makeVuln({ id: "GHSA-safe" })];
    const allowlist: AllowlistEntry[] = [{ id: "GHSA-safe", reason: "No fix", expires: "2099-01-01" }];
    const result = filterVulnerabilities(makeAuditResult(vulns), allowlist);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toHaveLength(1);
  });

  it("partially passes with mixed allowlisted and non-allowlisted vulns", () => {
    const vulns = [
      makeVuln({ id: "GHSA-safe", severity: "high" }),
      makeVuln({ id: "GHSA-danger", severity: "critical" }),
    ];
    const allowlist: AllowlistEntry[] = [{ id: "GHSA-safe", reason: "No fix", expires: "2099-01-01" }];
    const result = filterVulnerabilities(makeAuditResult(vulns), allowlist);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe("GHSA-danger");
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0].id).toBe("GHSA-safe");
  });

  it("distinguishes allowlist entries by exact id match", () => {
    const vulns = [
      makeVuln({ id: "GHSA-one" }),
      makeVuln({ id: "GHSA-two" }),
    ];
    const allowlist: AllowlistEntry[] = [{ id: "GHSA-one", reason: "Approved", expires: "2099-01-01" }];
    const result = filterVulnerabilities(makeAuditResult(vulns), allowlist);
    expect(result.allowed).toHaveLength(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe("GHSA-two");
  });

  it("handles empty allowlist with vulnerabilities", () => {
    const vulns = [makeVuln(), makeVuln({ id: "GHSA-another" })];
    const result = filterVulnerabilities(makeAuditResult(vulns), []);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.allowed).toHaveLength(0);
  });
});

describe("runNpmAudit", () => {
  afterEach(() => {
    mockedExecSync.mockReset();
  });

  it("executes npm audit --json and parses output", () => {
    const fakeOutput = JSON.stringify({
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 0 } },
    });
    mockedExecSync.mockReturnValue(fakeOutput);

    const result = runNpmAudit("/some/cwd");
    expect(mockedExecSync).toHaveBeenCalledWith("npm audit --json", {
      cwd: "/some/cwd",
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.metadata.totalCount).toBe(0);
  });

  it("recovers when execSync throws with stdout (vulns found case)", () => {
    const fakeOutput = JSON.stringify({
      vulnerabilities: {
        risky: {
          name: "risky",
          severity: "critical",
          via: [{ source: 999, name: "risky", title: "Critical issue", severity: "critical" }],
        },
      },
      metadata: { vulnerabilities: { critical: 1, total: 1 } },
    });
    const error = Object.assign(
      new Error("Command failed: npm audit --json"),
      { stdout: fakeOutput, stderr: "" }
    );
    mockedExecSync.mockImplementation(() => {
      throw error;
    });

    const result = runNpmAudit();
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].severity).toBe("critical");
  });

  it("re-throws when execSync throws without stdout", () => {
    const error = Object.assign(
      new Error("npm not found"),
      { stdout: null, stderr: "npm ERR! missing package-lock.json" }
    );
    mockedExecSync.mockImplementation(() => {
      throw error;
    });

    expect(() => runNpmAudit()).toThrow("npm audit failed");
  });

  it("re-throws using error.message when neither stdout nor stderr is present", () => {
    const error = Object.assign(
      new Error("EPERM: operation not permitted"),
      { stdout: null, stderr: null }
    );
    mockedExecSync.mockImplementation(() => {
      throw error;
    });

    expect(() => runNpmAudit()).toThrow("EPERM: operation not permitted");
  });
});

describe("checkDependencies", () => {
  let mockExistsSync: jest.Mock;
  let mockReadFileSync: jest.Mock;

  beforeEach(() => {
    mockExistsSync = require("node:fs").existsSync;
    mockReadFileSync = require("node:fs").readFileSync;
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    mockedExecSync.mockReset();
  });

  it("passes when no vulnerabilities exist", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } })
    );
    mockExistsSync.mockReturnValue(false);

    const result = checkDependencies({ cwd: "/test" });
    expect(result.pass).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails when high/critical vulnerabilities are found and allowlist is empty", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        vulnerabilities: {
          bad: {
            name: "bad",
            severity: "high",
            via: [{ source: 1, name: "bad", title: "Bad vuln", severity: "high" }],
          },
        },
        metadata: { vulnerabilities: { high: 1, total: 1 } },
      })
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("[]");

    const result = checkDependencies();
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it("passes when vulnerabilities are all allowlisted", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        vulnerabilities: {
          allowedPkg: {
            name: "allowedPkg",
            severity: "high",
            via: [{ source: 42, name: "allowedPkg", title: "Known issue", severity: "high" }],
          },
        },
        metadata: { vulnerabilities: { high: 1, total: 1 } },
      })
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ id: "42", reason: "No fix available", expires: "2099-01-01" }])
    );

    const result = checkDependencies();
    expect(result.pass).toBe(true);
    expect(result.allowed).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("fails when some vulnerabilities are not allowlisted", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        vulnerabilities: {
          safe: {
            name: "safe",
            severity: "high",
            via: [{ source: 10, name: "safe", title: "Known vuln", severity: "high" }],
          },
          dangerous: {
            name: "dangerous",
            severity: "critical",
            via: [{ source: 20, name: "dangerous", title: "Unknown vuln", severity: "critical" }],
          },
        },
        metadata: { vulnerabilities: { high: 1, critical: 1, total: 2 } },
      })
    );
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ id: "10", reason: "Approved", expires: "2099-01-01" }])
    );

    const result = checkDependencies();
    expect(result.pass).toBe(false);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0].id).toBe("10");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].id).toBe("20");
  });

  it("ignores low and moderate severity vulnerabilities (only high/critical fail)", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        vulnerabilities: {
          lowRisk: {
            name: "lowRisk",
            severity: "low",
            via: [{ source: 1, name: "lowRisk", title: "Low severity", severity: "low" }],
          },
          moderateRisk: {
            name: "moderateRisk",
            severity: "moderate",
            via: [{ source: 2, name: "moderateRisk", title: "Moderate severity", severity: "moderate" }],
          },
        },
        metadata: { vulnerabilities: { low: 1, moderate: 1, total: 2 } },
      })
    );
    mockExistsSync.mockReturnValue(false);

    const result = checkDependencies();
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("fails on critical severity even when mixed with low and moderate", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({
        vulnerabilities: {
          lowRisk: {
            name: "lowRisk",
            severity: "low",
            via: [{ source: 1, name: "lowRisk", title: "Low", severity: "low" }],
          },
          critRisk: {
            name: "critRisk",
            severity: "critical",
            via: [{ source: 2, name: "critRisk", title: "Critical!", severity: "critical" }],
          },
        },
        metadata: { vulnerabilities: { low: 1, critical: 1, total: 2 } },
      })
    );
    mockExistsSync.mockReturnValue(false);

    const result = checkDependencies();
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe("critical");
  });

  it("uses process.cwd() when no options provided", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } })
    );
    mockExistsSync.mockReturnValue(false);

    const result = checkDependencies();
    expect(result.pass).toBe(true);
    expect(mockedExecSync).toHaveBeenCalledWith("npm audit --json", expect.objectContaining({
      cwd: process.cwd(),
    }));
  });

  it("accepts custom allowlist path", () => {
    mockedExecSync.mockReturnValue(
      JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } })
    );
    mockExistsSync.mockReturnValue(false);

    const result = checkDependencies({ cwd: "/custom", allowlistPath: "/custom/allowlist.json" });
    expect(result.pass).toBe(true);
  });
});
