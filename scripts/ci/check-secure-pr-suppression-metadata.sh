#!/usr/bin/env bash
set -u

node <<'NODE'
const fs = require("node:fs");

const osvConfigPath = process.env.OSV_CONFIG_PATH ?? "osv-scanner.toml";
const gitleaksConfigPath = process.env.GITLEAKS_CONFIG_PATH ?? ".gitleaks.toml";
const gitleaksIgnorePath = process.env.GITLEAKS_IGNORE_PATH ?? ".gitleaksignore";
const today = process.env.SECURITY_SUPPRESSION_TODAY ?? new Date().toISOString().slice(0, 10);
let failed = false;

function emitError(message) {
  if (process.env.GITHUB_ACTIONS) {
    console.error(`::error::${message}`);
  } else {
    console.error(`ERROR: ${message}`);
  }
  failed = true;
}

function validateReviewDate(file, lineNumber, reviewBy) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) {
    emitError(`${file}:${lineNumber} suppression is missing review-by YYYY-MM-DD metadata.`);
  } else if (reviewBy < today) {
    emitError(`${file}:${lineNumber} suppression review date ${reviewBy} is before ${today}.`);
  } else {
    const maximumReviewDate = new Date(`${today}T00:00:00Z`);
    maximumReviewDate.setUTCDate(maximumReviewDate.getUTCDate() + 90);
    const maximumReviewBy = maximumReviewDate.toISOString().slice(0, 10);
    if (reviewBy > maximumReviewBy) {
      emitError(`${file}:${lineNumber} suppression review date must be no more than 90 days after ${today}.`);
    }
  }
}

function validateOsvSuppressions() {
  if (!fs.existsSync(osvConfigPath)) {
    emitError(`OSV config is missing: ${osvConfigPath}`);
    return;
  }

  const lines = fs.readFileSync(osvConfigPath, "utf8").split(/\r?\n/);
  const headers = [];
  lines.forEach((line, index) => {
    if (/^\s*\[\[[^\]]+\]\]\s*$/.test(line)) {
      headers.push(index);
    }
  });

  headers.forEach((start, headerIndex) => {
    const end = headers[headerIndex + 1] ?? lines.length;
    const header = lines[start].trim();
    const block = lines.slice(start, end).join("\n");

    if (header === "[[PackageOverrides]]" && /^\s*(?:vulnerability\.)?ignore\s*=\s*true\s*$/m.test(block)) {
      emitError(`${osvConfigPath}:${start + 1} broad package vulnerability suppressions are not allowed; use IgnoredVulns.`);
      return;
    }
    if (header !== "[[IgnoredVulns]]") {
      return;
    }

    const id = block.match(/^\s*id\s*=\s*"([^"]+)"\s*$/m)?.[1];
    const reason = block.match(/^\s*reason\s*=\s*"([^"]+)"\s*$/m)?.[1];
    const owner = block.match(/^\s*#\s*owner\s*=\s*"([A-Za-z0-9_.-]+)"\s*$/m)?.[1];
    const reviewBy = block.match(/^\s*ignoreUntil\s*=\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m)?.[1] ?? "";

    if (!id) {
      emitError(`${osvConfigPath}:${start + 1} OSV suppression is missing a vulnerability ID.`);
    }
    if (!reason?.trim()) {
      emitError(`${osvConfigPath}:${start + 1} OSV suppression is missing a rationale.`);
    }
    if (!owner) {
      emitError(`${osvConfigPath}:${start + 1} OSV suppression is missing an owner comment.`);
    }
    validateReviewDate(osvConfigPath, start + 1, reviewBy);
  });
}

function validateGitleaksSuppressions() {
  if (!fs.existsSync(gitleaksConfigPath)) {
    emitError(`Gitleaks config is missing: ${gitleaksConfigPath}`);
  } else {
    const config = fs.readFileSync(gitleaksConfigPath, "utf8");
    if (/^\s*(?:\[+[^\]]*allowlist|allowlists?\s*=)/im.test(config)) {
      emitError(`${gitleaksConfigPath} must not contain broad allowlists; use a reviewed fingerprint.`);
    }
  }

  if (!fs.existsSync(gitleaksIgnorePath)) {
    emitError(`Gitleaks ignore file is missing: ${gitleaksIgnorePath}`);
    return;
  }

  const lines = fs.readFileSync(gitleaksIgnorePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const fingerprint = line.trim();
    if (!fingerprint || fingerprint.startsWith("#")) {
      return;
    }

    const metadata = lines[index - 1]?.trim() ?? "";
    const match = metadata.match(/^# owner=([A-Za-z0-9_.-]+); review-by=(\d{4}-\d{2}-\d{2}); reason=(\S.*)$/);
    if (!match) {
      emitError(`${gitleaksIgnorePath}:${index + 1} fingerprint must be preceded by owner, review-by, and reason metadata.`);
    } else {
      validateReviewDate(gitleaksIgnorePath, index + 1, match[2]);
    }

    if (!/^(?:[0-9a-f]{40,64}:)?[^:]+:[^:]+:\d+$/.test(fingerprint)) {
      emitError(`${gitleaksIgnorePath}:${index + 1} is not a scoped Gitleaks fingerprint.`);
    }
  });
}

validateOsvSuppressions();
validateGitleaksSuppressions();
process.exit(failed ? 1 : 0);
NODE
