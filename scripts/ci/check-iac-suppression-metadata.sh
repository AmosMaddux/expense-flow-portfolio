#!/usr/bin/env bash
set -u

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.IAC_TERRAFORM_ROOT ?? "infra/terraform";
const checkovConfigPath = process.env.CHECKOV_CONFIG_PATH ?? ".checkov.yaml";
const today = process.env.IAC_SUPPRESSION_TODAY ?? new Date().toISOString().slice(0, 10);
let failed = false;

function emitError(message) {
  if (process.env.GITHUB_ACTIONS) {
    console.error(`::error::${message}`);
  } else {
    console.error(`ERROR: ${message}`);
  }
  failed = true;
}

function terraformFiles(directory) {
  if (!fs.existsSync(directory)) {
    emitError(`Terraform root is missing: ${directory}`);
    return [];
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...terraformFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".tf")) {
      files.push(entryPath);
    }
  }

  return files;
}

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//");
}

function opensTerraformBlock(line) {
  return /^\s*(resource|data|module)\s+"[^"]+"(?:\s+"[^"]+")?\s*\{/.test(line);
}

function updateDepth(line, depth) {
  const withoutLineComment = line.replace(/#.*/, "").replace(/\/\/.*/, "");
  const opens = (withoutLineComment.match(/\{/g) ?? []).length;
  const closes = (withoutLineComment.match(/\}/g) ?? []).length;
  return Math.max(0, depth + opens - closes);
}

function nextMeaningfulLine(lines, index) {
  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    if (!isBlankOrComment(lines[nextIndex])) {
      return lines[nextIndex];
    }
  }

  return null;
}

function validateCheckovConfig() {
  if (!fs.existsSync(checkovConfigPath)) {
    return;
  }

  const lines = fs.readFileSync(checkovConfigPath, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*skip-check\s*:/.test(line)) {
      continue;
    }

    const inlineValue = line.split(/skip-check\s*:/, 2)[1].trim();
    if (inlineValue && inlineValue !== "[]") {
      emitError(`${checkovConfigPath}:${index + 1} global skip-check entries are not allowed; use inline suppressions with metadata.`);
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (/^\s*$/.test(nextLine) || /^\s*#/.test(nextLine)) {
        continue;
      }
      if (/^\s+-\s+\S+/.test(nextLine)) {
        emitError(`${checkovConfigPath}:${nextIndex + 1} global skip-check entries are not allowed; use inline suppressions with metadata.`);
      }
      break;
    }
  }
}

function validateSuppression(file, lineNumber, line, lines, index, depthBeforeLine) {
  const isCheckov = line.includes("checkov:skip");
  const isTfsec = line.includes("tfsec:ignore");
  if (!isCheckov && !isTfsec) {
    return;
  }

  if (isCheckov && !/#checkov:skip=[^:\s]+:\s+\S+/.test(line)) {
    emitError(`${file}:${lineNumber} Checkov suppression must include scanner and check ID plus rationale.`);
  }
  if (isTfsec && !/#tfsec:ignore:[^\s]+\s+\S+/.test(line)) {
    emitError(`${file}:${lineNumber} tfsec suppression must include scanner and check ID plus rationale.`);
  }
  if (isCheckov && depthBeforeLine <= 0) {
    emitError(`${file}:${lineNumber} Checkov suppression must be inside the Terraform block it suppresses.`);
  }
  if (isTfsec) {
    const nextLine = nextMeaningfulLine(lines, index);
    if (!nextLine || !opensTerraformBlock(nextLine)) {
      emitError(`${file}:${lineNumber} tfsec suppression must be directly above the Terraform block it suppresses.`);
    }
  }

  const owner = line.match(/owner\s+([A-Za-z0-9_.-]+)/i)?.[1];
  if (!owner) {
    emitError(`${file}:${lineNumber} suppression is missing owner.`);
  }

  const reviewBy = line.match(/review by\s+(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (!reviewBy) {
    emitError(`${file}:${lineNumber} suppression is missing review by YYYY-MM-DD.`);
  } else if (reviewBy < today) {
    emitError(`${file}:${lineNumber} suppression review date ${reviewBy} is before ${today}.`);
  }
}

validateCheckovConfig();

for (const file of terraformFiles(root)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let depth = 0;

  lines.forEach((line, index) => {
    validateSuppression(file, index + 1, line, lines, index, depth);
    depth = updateDepth(line, depth);
  });
}

process.exit(failed ? 1 : 0);
NODE