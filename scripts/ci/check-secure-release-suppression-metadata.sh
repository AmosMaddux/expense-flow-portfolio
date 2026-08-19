#!/usr/bin/env bash
set -u

node <<'NODE'
const fs = require("node:fs");

const trivyIgnorePath = process.env.TRIVYIGNORE_PATH ?? ".trivyignore";
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

function validateTrivySuppressions() {
  if (!fs.existsSync(trivyIgnorePath)) {
    emitError(`Trivy ignore file is missing: ${trivyIgnorePath}`);
    return;
  }

  const lines = fs.readFileSync(trivyIgnorePath, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) {
      return;
    }

    const metadata = lines[index - 1]?.trim() ?? "";
    const match = metadata.match(/^# owner=([A-Za-z0-9_.-]+); review-by=(\d{4}-\d{2}-\d{2}); reason=(\S.*)$/);
    if (!match) {
      emitError(`${trivyIgnorePath}:${index + 1} suppression must be preceded by owner, review-by, and reason metadata.`);
    } else {
      validateReviewDate(trivyIgnorePath, index + 1, match[2]);
    }

    if (!/^CVE-\d{4}-\d{4,}$/.test(entry)) {
      emitError(`${trivyIgnorePath}:${index + 1} is not a CVE identifier.`);
    }
  });
}

validateTrivySuppressions();
process.exit(failed ? 1 : 0);
NODE
