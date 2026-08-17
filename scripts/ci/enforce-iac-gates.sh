#!/usr/bin/env bash
set -u

if [[ $# -ne 2 ]]; then
  echo "usage: $0 CHECKOV_JSON TFSEC_SARIF" >&2
  exit 2
fi

node - "$1" "$2" <<'NODE'
const fs = require("node:fs");

const [checkovPath, tfsecPath] = process.argv.slice(2);
let failed = false;

function emitError(message) {
  if (process.env.GITHUB_ACTIONS) {
    console.error(`::error::${message}`);
  } else {
    console.error(`ERROR: ${message}`);
  }
  failed = true;
}

function readJson(path, label) {
  if (!fs.existsSync(path) || !fs.statSync(path).isFile()) {
    emitError(`${label} report is missing: ${path}`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    emitError(`${label} report could not be parsed as JSON: ${error.message}`);
    return null;
  }
}

function tfsecSeverity(rules, result) {
  const matchingRule = rules.find((rule) => rule.id === result.ruleId) ?? {};
  return (
    result.properties?.severity ??
    result.properties?.["security-severity"] ??
    result.level ??
    matchingRule.properties?.severity ??
    matchingRule.properties?.["security-severity"] ??
    matchingRule.defaultConfiguration?.level ??
    null
  );
}

function isHighOrCritical(rawSeverity) {
  const severity = String(rawSeverity).toLowerCase();
  if (["high", "critical", "error"].includes(severity)) {
    return true;
  }

  const numericSeverity = Number(severity);
  return Number.isFinite(numericSeverity) && numericSeverity >= 7.0;
}

const checkov = readJson(checkovPath, "Checkov JSON");
if (checkov) {
  const reports = Array.isArray(checkov) ? checkov : [checkov];
  const failedChecks = [];
  let malformedReports = 0;

  for (const report of reports) {
    const reportFailedChecks = report?.results?.failed_checks;
    if (!Array.isArray(reportFailedChecks)) {
      malformedReports += 1;
    } else {
      failedChecks.push(...reportFailedChecks);
    }
  }

  if (malformedReports > 0) {
    emitError("Checkov JSON report is missing results.failed_checks array metadata.");
  } else {
    const missingIds = failedChecks.filter((check) => !check.check_id).length;
    if (missingIds > 0) {
      emitError("Checkov JSON report contains failed checks without check_id metadata.");
    }
    if (failedChecks.length > 0) {
      emitError("Checkov found Terraform misconfigurations. Fix the finding or follow docs/iac-scanning-suppressions.md.");
    }
  }
}

const tfsec = readJson(tfsecPath, "tfsec SARIF");
if (tfsec) {
  if (!Array.isArray(tfsec.runs)) {
    emitError("tfsec SARIF report is missing runs array metadata.");
  } else {
    let missingSeverity = 0;
    let highFindings = 0;

    for (const run of tfsec.runs) {
      const rules = run.tool?.driver?.rules ?? [];
      for (const result of run.results ?? []) {
        const severity = tfsecSeverity(rules, result);
        if (severity === null || severity === undefined || severity === "") {
          missingSeverity += 1;
        } else if (isHighOrCritical(severity)) {
          highFindings += 1;
        }
      }
    }

    if (missingSeverity > 0) {
      emitError("tfsec SARIF report contains findings without severity metadata.");
    }
    if (highFindings > 0) {
      emitError("tfsec found high or critical Terraform misconfigurations. Fix the finding or follow docs/iac-scanning-suppressions.md.");
    }
  }
}

process.exit(failed ? 1 : 0);
NODE