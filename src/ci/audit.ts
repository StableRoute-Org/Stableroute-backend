import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface AllowlistEntry {
  id: string;
  reason: string;
  expires: string;
}

export interface Vulnerability {
  id: string;
  packageName: string;
  severity: "low" | "moderate" | "high" | "critical";
  title: string;
  url: string;
}

export interface AuditResult {
  vulnerabilities: Vulnerability[];
  metadata: {
    totalCount: number;
    highCount: number;
    criticalCount: number;
  };
}

export interface FilteredResult {
  pass: boolean;
  violations: Vulnerability[];
  allowed: Vulnerability[];
}

interface NpmAdvisoryObject {
  source?: number;
  name?: string;
  dependency?: string;
  title?: string;
  url?: string;
  severity?: string;
  cwe?: string[];
  range?: string;
}

interface NpmPackageVulnerability {
  name?: string;
  severity?: string;
  via?: (string | NpmAdvisoryObject)[];
  range?: string;
  fixAvailable?: boolean;
}

interface ExecError extends Error {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export function loadAllowlist(filePath?: string): AllowlistEntry[] {
  const path = filePath ?? resolve(process.cwd(), ".audit-allowlist.json");
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Allowlist must be a JSON array");
  }
  const now = new Date();
  return parsed.filter((entry: AllowlistEntry) => {
    if (!entry.id || typeof entry.id !== "string") {
      throw new Error(`Allowlist entry missing 'id' field: ${JSON.stringify(entry)}`);
    }
    if (entry.expires && new Date(entry.expires) <= now) {
      return false;
    }
    return true;
  });
}

const ADVISORY_URL_GHSA_RE = /GHSA-[\w-]+/;

export function parseAuditOutput(jsonOutput: string): AuditResult {
  const data = JSON.parse(jsonOutput) as Record<string, unknown>;
  const vulnerabilities: Vulnerability[] = [];
  const vulnMap = data.vulnerabilities as Record<string, NpmPackageVulnerability> | undefined ?? {};

  for (const [pkgName, pkgVuln] of Object.entries(vulnMap)) {
    const via = pkgVuln.via ?? [];
    for (const advisory of via) {
      if (typeof advisory === "object" && advisory !== null) {
        if (advisory.source == null && !advisory.url) continue;
        const sourceId = advisory.source != null ? String(advisory.source) : "";
        const ghsaMatch = typeof advisory.url === "string" ? advisory.url.match(ADVISORY_URL_GHSA_RE) : null;
        const ghsaId = ghsaMatch ? ghsaMatch[0] : "";
        const id = ghsaId || sourceId;
        if (!id) continue;
        vulnerabilities.push({
          id,
          packageName: pkgName,
          severity: (advisory.severity ?? pkgVuln.severity ?? "high") as Vulnerability["severity"],
          title: advisory.title ?? "Unknown advisory",
          url: advisory.url ?? "",
        });
      }
    }
  }

  const meta = data.metadata as Record<string, unknown> | undefined;
  const vulnMeta = meta?.vulnerabilities as Record<string, number> | undefined ?? {};
  return {
    vulnerabilities,
    metadata: {
      totalCount: (vulnMeta.total as number) ?? vulnerabilities.length,
      highCount: (vulnMeta.high as number) ?? 0,
      criticalCount: (vulnMeta.critical as number) ?? 0,
    },
  };
}

export function filterVulnerabilities(
  auditResult: AuditResult,
  allowlist: AllowlistEntry[]
): FilteredResult {
  const allowedIds = new Set(allowlist.map((e) => e.id));
  const violations: Vulnerability[] = [];
  const allowed: Vulnerability[] = [];

  for (const vuln of auditResult.vulnerabilities) {
    if (allowedIds.has(vuln.id)) {
      allowed.push(vuln);
    } else {
      violations.push(vuln);
    }
  }

  return {
    pass: violations.length === 0,
    violations,
    allowed,
  };
}

export function runNpmAudit(cwd?: string): AuditResult {
  const workDir = cwd ?? process.cwd();
  try {
    const result = execSync("npm audit --json", {
      cwd: workDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseAuditOutput(result);
  } catch (error) {
    const execError = error as ExecError;
    if (execError.stdout) {
      return parseAuditOutput(execError.stdout.toString());
    }
    throw new Error(
      `npm audit failed: ${execError.stderr?.toString() ?? execError.message ?? error}`
    );
  }
}

export function checkDependencies(options?: {
  cwd?: string;
  allowlistPath?: string;
}): FilteredResult {
  const auditResult = runNpmAudit(options?.cwd);
  const allowlist = loadAllowlist(options?.allowlistPath);
  const highCriticalVulns = auditResult.vulnerabilities.filter(
    (v) => v.severity === "high" || v.severity === "critical"
  );
  return filterVulnerabilities(
    { ...auditResult, vulnerabilities: highCriticalVulns },
    allowlist
  );
}
