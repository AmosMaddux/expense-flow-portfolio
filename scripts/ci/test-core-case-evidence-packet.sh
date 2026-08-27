#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
runtime_dir="${TMPDIR:-/tmp}/core-case-evidence-packet-contract.$$"
input_root="$runtime_dir/input"
output_root="$runtime_dir/output"

cleanup() {
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

write_fixture() {
  local relative_path=$1
  local content=$2

  mkdir -p "$(dirname "$input_root/$relative_path")"
  printf '%s\n' "$content" > "$input_root/$relative_path"
}

write_fixture test-output/typescript-vitest.txt "synthetic vitest output"
write_fixture test-output/python-pytest.txt "synthetic pytest output"
write_fixture coverage/typescript/coverage-summary.json '{"total":{"lines":{"pct":100}}}'
write_fixture coverage/python/coverage.xml '<coverage branch-rate="1" line-rate="1"></coverage>'
write_fixture security/semgrep-report.json '{"results":[],"errors":[]}'
write_fixture security/bandit-report.json '{"results":[]}'
write_fixture security/trivy-report.json '{"Results":[]}'
write_fixture security/sbom.cdx.json '{"bomFormat":"CycloneDX","components":[]}'
write_fixture signing/cosign-sign-image.txt "signed"
write_fixture signing/cosign-attest-sbom.txt "attested"
write_fixture signing/cosign-verify-image.txt "verified image"
write_fixture signing/cosign-verify-attestation.txt "verified attestation"

GITHUB_REPOSITORY=AI-Native-2026-06-22-FedStack/expense-flow-project-team-3 \
GITHUB_SHA=synthetic-sha \
GITHUB_REF=refs/heads/feature/synthetic \
GITHUB_REF_NAME=feature/synthetic \
GITHUB_WORKFLOW="Core Case Evidence Packet" \
GITHUB_RUN_ID=123 \
GITHUB_RUN_ATTEMPT=1 \
IMAGE_REF=ghcr.io/example/evidence/core-case-service:synthetic-sha \
IMAGE_DIGEST=sha256:synthetic \
EVIDENCE_PACKET_INPUT_ROOT="$input_root" \
EVIDENCE_PACKET_OUTPUT_ROOT="$output_root" \
  node "$repo_root/scripts/ci/assemble-core-case-evidence-packet.mjs"

test -f "$output_root/manifest.json"
test -f "$output_root/reproduce-tagged-build.md"

node - "$output_root/manifest.json" <<'NODE'
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = new Map([
  ["test-output/typescript-vitest.txt", "typescript-vitest-tests"],
  ["test-output/python-pytest.txt", "python-pytest-tests"],
  ["coverage/typescript", "typescript-vitest-tests"],
  ["coverage/python", "python-pytest-tests"],
  ["security/semgrep-report.json", "semgrep-source-sast"],
  ["security/bandit-report.json", "bandit-python-sast"],
  ["security/trivy-report.json", "trivy-image-vulnerability-scan"],
  ["security/sbom.cdx.json", "syft-sbom"],
  ["signing/cosign-sign-image.txt", "cosign-image-signature"],
  ["signing/cosign-attest-sbom.txt", "cosign-sbom-attestation"],
  ["signing/cosign-verify-image.txt", "cosign-image-verification"],
  ["signing/cosign-verify-attestation.txt", "cosign-attestation-verification"],
  ["reproduce-tagged-build.md", "evidence-packet-assembler"],
]);

if (manifest.service !== "core-case-service") {
  throw new Error(`Unexpected service: ${manifest.service}`);
}

for (const [artifactPath, gate] of expected) {
  const artifact = manifest.artifacts.find((entry) => entry.path === artifactPath);
  if (!artifact) {
    throw new Error(`Missing manifest artifact: ${artifactPath}`);
  }
  if (artifact.gate !== gate) {
    throw new Error(`Unexpected gate for ${artifactPath}: ${artifact.gate}`);
  }
}
NODE

rm "$input_root/security/bandit-report.json"

if EVIDENCE_PACKET_INPUT_ROOT="$input_root" EVIDENCE_PACKET_OUTPUT_ROOT="$output_root-missing" \
  node "$repo_root/scripts/ci/assemble-core-case-evidence-packet.mjs"; then
  echo "Expected assembler to fail when a required artifact is missing." >&2
  exit 1
fi

echo "Core Case evidence packet contract tests passed."
