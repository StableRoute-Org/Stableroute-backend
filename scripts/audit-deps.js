require("ts-node").register({ transpileOnly: true });
const { checkDependencies } = require("../src/ci/audit");

function main() {
  let result;
  try {
    result = checkDependencies();
  } catch (err) {
    console.error("Dependency audit error:", err.message);
    process.exit(2);
  }

  if (result.violations.length > 0) {
    console.error("Dependency audit FAILED:");
    for (const v of result.violations) {
      console.error("  [%s] %s: %s (%s)", v.severity.toUpperCase(), v.packageName, v.title, v.id);
      if (v.url) console.error("    %s", v.url);
    }
  }

  if (result.allowed.length > 0) {
    console.log("Allowlisted advisories (expiration pending):");
    for (const v of result.allowed) {
      console.log("  [%s] %s: %s (%s)", v.severity.toUpperCase(), v.packageName, v.title, v.id);
    }
  }

  if (result.violations.length === 0) {
    console.log("Dependency audit PASSED.");
  }

  process.exit(result.pass ? 0 : 1);
}

main();
