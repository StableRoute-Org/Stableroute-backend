import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";

const ROOT = path.resolve(__dirname, "..", "..");
const CODEQL_WORKFLOW_PATH = path.join(
  ROOT,
  ".github",
  "workflows",
  "codeql.yml",
);
const CODEQL_CONFIG_PATH = path.join(
  ROOT,
  ".github",
  "codeql",
  "codeql-config.yml",
);
const CI_WORKFLOW_PATH = path.join(ROOT, ".github", "workflows", "ci.yml");

function loadYaml(filePath: string): Record<string, unknown> {
  const raw = fs.readFileSync(filePath, "utf-8");
  return yaml.load(raw) as Record<string, unknown>;
}

describe("CodeQL workflow (.github/workflows/codeql.yml)", () => {
  let codeqlWorkflow: Record<string, unknown>;

  beforeAll(() => {
    codeqlWorkflow = loadYaml(CODEQL_WORKFLOW_PATH);
  });

  it("file exists and is parseable YAML", () => {
    expect(fs.existsSync(CODEQL_WORKFLOW_PATH)).toBe(true);
    expect(codeqlWorkflow).toBeDefined();
    expect(typeof codeqlWorkflow).toBe("object");
    expect(codeqlWorkflow).not.toBeNull();
  });

  it("has the expected name", () => {
    expect(codeqlWorkflow.name).toMatch(/codeql/i);
  });

  describe("on: triggers", () => {
    let on: Record<string, unknown>;

    beforeAll(() => {
      on = codeqlWorkflow.on as Record<string, unknown>;
    });

    it("defines push trigger", () => {
      expect(on).toHaveProperty("push");
      const push = on.push as Record<string, unknown>;
      expect(push).toHaveProperty("branches");
      expect(push.branches).toContain("main");
    });

    it("defines pull_request trigger", () => {
      expect(on).toHaveProperty("pull_request");
      const pr = on.pull_request as Record<string, unknown>;
      expect(pr).toHaveProperty("branches");
      expect(pr.branches).toContain("main");
    });

    it("defines weekly schedule trigger", () => {
      expect(on).toHaveProperty("schedule");
      const schedule = on.schedule as Array<Record<string, unknown>>;
      expect(Array.isArray(schedule)).toBe(true);
      expect(schedule.length).toBeGreaterThanOrEqual(1);
      expect(schedule[0]).toHaveProperty("cron");
      expect(typeof schedule[0].cron).toBe("string");
      const cronParts = (schedule[0].cron as string).trim().split(/\s+/);
      expect(cronParts.length).toBe(5);
    });

    it("push has path filters for src/ and workflow files", () => {
      const push = on.push as Record<string, unknown>;
      expect(push).toHaveProperty("paths");
      const paths = push.paths as string[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.some((p) => p.includes("src/**"))).toBe(true);
      expect(paths.some((p) => p.includes("codeql.yml"))).toBe(true);
    });

    it("pull_request has path filters for src/ and workflow files", () => {
      const pr = on.pull_request as Record<string, unknown>;
      expect(pr).toHaveProperty("paths");
      const paths = pr.paths as string[];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.some((p) => p.includes("src/**"))).toBe(true);
      expect(paths.some((p) => p.includes("codeql.yml"))).toBe(true);
    });
  });

  describe("jobs.analyze", () => {
    let jobs: Record<string, unknown>;
    let analyze: Record<string, unknown>;

    beforeAll(() => {
      jobs = codeqlWorkflow.jobs as Record<string, unknown>;
      analyze = jobs.analyze as Record<string, unknown>;
    });

    it("defines an analyze job", () => {
      expect(jobs).toHaveProperty("analyze");
    });

    it("runs on ubuntu-latest", () => {
      expect(analyze["runs-on"]).toBe("ubuntu-latest");
    });

    it("has strategy matrix with javascript-typescript language", () => {
      const strategy = analyze.strategy as Record<string, unknown>;
      expect(strategy).toBeDefined();
      expect(strategy["fail-fast"]).toBe(false);
      const matrix = strategy.matrix as Record<string, unknown>;
      expect(matrix).toHaveProperty("language");
      const languages = matrix.language as string[];
      expect(Array.isArray(languages)).toBe(true);
      expect(languages).toContain("javascript-typescript");
    });

    it("grants security-events write permission for SARIF upload", () => {
      const permissions = analyze.permissions as Record<string, unknown>;
      expect(permissions).toBeDefined();
      expect(permissions["security-events"]).toBe("write");
    });

    describe("steps", () => {
      let steps: Array<Record<string, unknown>>;

      beforeAll(() => {
        steps = analyze.steps as Array<Record<string, unknown>>;
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThan(4);
      });

      function findStep(
        predicate: (s: Record<string, unknown>) => boolean,
      ): Record<string, unknown> | undefined {
        return steps.find(predicate);
      }

      it("includes checkout step (actions/checkout@v4)", () => {
        const checkout = findStep((s) =>
          String(s.uses || "").startsWith("actions/checkout"),
        );
        expect(checkout).toBeDefined();
        expect(checkout!.uses).toBe("actions/checkout@v4");
      });

      it("includes Node.js setup step with version 24 and npm cache", () => {
        const setupNode = findStep((s) =>
          String(s.uses || "").startsWith("actions/setup-node"),
        );
        expect(setupNode).toBeDefined();
        expect(setupNode!.uses).toBe("actions/setup-node@v4");
        const withObj = setupNode!.with as Record<string, unknown>;
        expect(withObj["node-version"]).toBe("24");
        expect(withObj.cache).toBe("npm");
      });

      it("includes npm ci install step", () => {
        const install = findStep(
          (s) =>
            typeof s.name === "string" &&
            /install/i.test(s.name) &&
            s.run === "npm ci",
        );
        expect(install).toBeDefined();
      });

      it("includes CodeQL init step with config-file and security-and-quality queries", () => {
        const init = findStep((s) =>
          String(s.uses || "").startsWith("github/codeql-action/init"),
        );
        expect(init).toBeDefined();
        const withObj = init!.with as Record<string, unknown>;
        expect(withObj.languages).toBe("${{ matrix.language }}");
        expect(withObj["config-file"]).toBe("./.github/codeql/codeql-config.yml");
        expect(withObj.queries).toBe("security-and-quality");
      });

      it("includes CodeQL autobuild step", () => {
        const autobuild = findStep((s) =>
          String(s.uses || "").startsWith("github/codeql-action/autobuild"),
        );
        expect(autobuild).toBeDefined();
      });

      it("includes CodeQL analyze step with upload enabled", () => {
        const analyze = findStep((s) =>
          String(s.uses || "").startsWith("github/codeql-action/analyze"),
        );
        expect(analyze).toBeDefined();
        const withObj = analyze!.with as Record<string, unknown>;
        expect(withObj.upload).toBe(true);
        expect(withObj.category).toContain("language");
      });

      it("includes SARIF artifact upload step with 30-day retention", () => {
        const upload = findStep((s) =>
          String(s.uses || "").startsWith("actions/upload-artifact"),
        );
        expect(upload).toBeDefined();
        const withObj = upload!.with as Record<string, unknown>;
        expect(withObj["retention-days"]).toBe(30);
      });
    });
  });
});

describe("CodeQL config (.github/codeql/codeql-config.yml)", () => {
  let codeqlConfig: Record<string, unknown>;

  beforeAll(() => {
    codeqlConfig = loadYaml(CODEQL_CONFIG_PATH);
  });

  it("file exists and is parseable YAML", () => {
    expect(fs.existsSync(CODEQL_CONFIG_PATH)).toBe(true);
    expect(codeqlConfig).toBeDefined();
    expect(typeof codeqlConfig).toBe("object");
    expect(codeqlConfig).not.toBeNull();
  });

  it("scopes paths to src only", () => {
    const paths = codeqlConfig.paths as string[];
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths.some((p) => p === "src" || p.startsWith("src/"))).toBe(true);
  });

  it("excludes node_modules, dist build output, coverage, and __tests__", () => {
    const ignore = codeqlConfig["paths-ignore"] as string[];
    expect(Array.isArray(ignore)).toBe(true);
    const joined = ignore.join("\n");
    expect(ignore.some((p) => p.includes("node_modules"))).toBe(true);
    expect(ignore.some((p) => p.includes("dist"))).toBe(true);
    expect(ignore.some((p) => p.includes("coverage"))).toBe(true);
    expect(joined).toMatch(/__tests__/);
  });

  it("includes the javascript-typescript CodeQL pack", () => {
    const packs = codeqlConfig.packs;
    expect(packs).toBeDefined();
    let found = false;
    if (Array.isArray(packs)) {
      for (const entry of packs) {
        if (typeof entry === "string" && entry.includes("javascript-typescript")) {
          found = true;
          break;
        }
        if (entry !== null && typeof entry === "object") {
          const keys = Object.keys(entry as Record<string, unknown>);
          if (keys.some((k) => k.includes("javascript-typescript"))) {
            found = true;
            break;
          }
        }
      }
    } else if (packs !== null && typeof packs === "object") {
      const keys = Object.keys(packs as Record<string, unknown>);
      found = keys.some((k) => k.includes("javascript-typescript"));
    }
    expect(found).toBe(true);
  });
});

describe("CI workflow non-regression (ci.yml still intact)", () => {
  let ciWorkflow: Record<string, unknown>;

  beforeAll(() => {
    ciWorkflow = loadYaml(CI_WORKFLOW_PATH);
  });

  it("ci.yml still has build-test job with lint, build, test, coverage steps", () => {
    const jobs = ciWorkflow.jobs as Record<string, unknown>;
    expect(jobs).toHaveProperty("validate-openapi");
    expect(jobs).toHaveProperty("build-test");
    const buildTest = jobs["build-test"] as Record<string, unknown>;
    const steps = buildTest.steps as Array<Record<string, unknown>>;
    const stepRuns = steps
      .filter((s) => typeof s.run === "string")
      .map((s) => s.run as string)
      .join("\n");
    expect(stepRuns).toContain("npm run lint");
    expect(stepRuns).toContain("npm run build");
    expect(stepRuns).toContain("npm test");
    expect(stepRuns).toContain("npm run test:coverage");
  });
});

describe("Edge cases and invariants", () => {
  it("codeql schedule cron format has exactly 5 whitespace-separated fields", () => {
    const wf = loadYaml(CODEQL_WORKFLOW_PATH);
    const on = wf.on as Record<string, unknown>;
    const schedule = on.schedule as Array<Record<string, unknown>>;
    for (const item of schedule) {
      const fields = (item.cron as string).trim().split(/\s+/);
      expect(fields).toHaveLength(5);
      expect(fields[4]).toBe("1");
    }
  });

  it("no CodeQL step reference includes node_modules or dist in paths inputs", () => {
    const wf = loadYaml(CODEQL_WORKFLOW_PATH);
    const jobs = wf.jobs as Record<string, unknown>;
    const analyze = jobs.analyze as Record<string, unknown>;
    const steps = analyze.steps as Array<Record<string, unknown>>;
    const dump = JSON.stringify(steps);
    expect(dump).not.toContain("node_modules");
    expect(dump).not.toContain("dist/");
  });

  it("workflow files have LF-compatible line endings (no bare CR)", () => {
    for (const p of [CODEQL_WORKFLOW_PATH, CODEQL_CONFIG_PATH]) {
      const content = fs.readFileSync(p, "utf-8");
      expect(content).not.toMatch(/\r(?!\n)/);
    }
  });

  it("src directory exists to be analyzed", () => {
    const srcDir = path.join(ROOT, "src");
    expect(fs.existsSync(srcDir)).toBe(true);
    const stat = fs.statSync(srcDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("index.ts is present under src/ (the large target file CodeQL must cover)", () => {
    const indexTs = path.join(ROOT, "src", "index.ts");
    expect(fs.existsSync(indexTs)).toBe(true);
    const sizeBytes = fs.statSync(indexTs).size;
    expect(sizeBytes).toBeGreaterThan(10_000);
  });
});
