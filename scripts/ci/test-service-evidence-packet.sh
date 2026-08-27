#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
runtime_dir="${TMPDIR:-/tmp}/service-evidence-packet-contract.$$"

cleanup() {
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

write_fixture() {
  local input_root=$1
  local relative_path=$2
  local content=$3

  mkdir -p "$(dirname "$input_root/$relative_path")"
  printf '%s\n' "$content" > "$input_root/$relative_path"
}

assemble_packet() {
  local service_name=$1
  local dockerfile=$2
  local input_root=$3
  local output_root=$4
  local artifacts_json=$5
  local commands_json=$6

  GITHUB_REPOSITORY=AI-Native-2026-06-22-FedStack/expense-flow-project-team-3 \
  GITHUB_SHA=synthetic-sha \
  GITHUB_REF=refs/heads/feature/synthetic \
  GITHUB_REF_NAME=feature/synthetic \
  GITHUB_WORKFLOW="Service Evidence Packets" \
  GITHUB_RUN_ID=123 \
  GITHUB_RUN_ATTEMPT=1 \
  IMAGE_REF="ghcr.io/example/evidence/$service_name:synthetic-sha" \
  IMAGE_DIGEST=sha256:synthetic \
  EVIDENCE_PACKET_SERVICE_NAME="$service_name" \
  EVIDENCE_PACKET_DOCKERFILE="$dockerfile" \
  EVIDENCE_PACKET_INPUT_ROOT="$input_root" \
  EVIDENCE_PACKET_OUTPUT_ROOT="$output_root" \
  EVIDENCE_PACKET_REQUIRED_ARTIFACTS_JSON="$artifacts_json" \
  EVIDENCE_PACKET_REPRODUCTION_COMMANDS_JSON="$commands_json" \
    node "$repo_root/scripts/ci/assemble-service-evidence-packet.mjs"
}

assert_manifest_artifacts() {
  local manifest_path=$1
  local service_name=$2
  local dockerfile=$3
  local expected_json=$4

  node - "$manifest_path" "$service_name" "$dockerfile" "$expected_json" <<'NODE'
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const serviceName = process.argv[3];
const dockerfile = process.argv[4];
const expected = new Map(JSON.parse(process.argv[5]));

if (manifest.service !== serviceName) {
  throw new Error(`Unexpected service: ${manifest.service}`);
}
if (manifest.image.dockerfile !== dockerfile) {
  throw new Error(`Unexpected dockerfile: ${manifest.image.dockerfile}`);
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
}

core_input_root="$runtime_dir/core-case/input"
core_output_root="$runtime_dir/core-case/output"
core_artifacts_json='[
  {"path":"test-output/typescript-vitest.txt","gate":"typescript-vitest-tests","description":"Vitest test and coverage command output"},
  {"path":"test-output/python-pytest.txt","gate":"python-pytest-tests","description":"Pytest test and coverage command output"},
  {"path":"coverage/typescript","gate":"typescript-vitest-tests","description":"V8 coverage report for Core Case TypeScript sources"},
  {"path":"coverage/python","gate":"python-pytest-tests","description":"Coverage report for Python tests run with pytest-cov"},
  {"path":"security/semgrep-report.json","gate":"semgrep-source-sast","description":"Semgrep high-severity TypeScript SAST report"},
  {"path":"security/bandit-report.json","gate":"bandit-python-sast","description":"Bandit high-severity Python SAST report"},
  {"path":"security/trivy-report.json","gate":"trivy-image-vulnerability-scan","description":"Trivy critical vulnerability report for the built image"},
  {"path":"security/sbom.cdx.json","gate":"syft-sbom","description":"Syft CycloneDX SBOM for the built image"},
  {"path":"signing/cosign-sign-image.txt","gate":"cosign-image-signature","description":"Cosign image signing command output"},
  {"path":"signing/cosign-attest-sbom.txt","gate":"cosign-sbom-attestation","description":"Cosign SBOM attestation command output"},
  {"path":"signing/cosign-verify-image.txt","gate":"cosign-image-verification","description":"Cosign image signature verification output"},
  {"path":"signing/cosign-verify-attestation.txt","gate":"cosign-attestation-verification","description":"Cosign SBOM attestation verification output"}
]'
core_commands_json='[
  "Install Node dependencies from the lockfile: `npm ci`.",
  "Install Python dependencies from the lockfile: `uv sync --frozen`.",
  "Run TypeScript tests and coverage: `npm run build && npx vitest run --coverage --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.lines=0 --coverage.thresholds.statements=0 --project unit --project integration --project production --exclude backend/core-case-service/src/glCoding/glCodingClient.pact.test.ts --passWithNoTests`.",
  "Run Python tests and coverage: `UV_CACHE_DIR=/tmp/expense-flow-uv-cache uv run pytest --cov=backend --cov=evaluation --cov-report=term --cov-report=xml:coverage/python/coverage.xml --cov-report=html:coverage/python/html`.",
  "Build the Core Case Service image: `docker build --file backend/core-case-service/Dockerfile --tag core-case-service:<tag> .`.",
  "Scan the image with Trivy, generate the Syft SBOM, sign the pushed image with Cosign, attest the SBOM, and verify both using the same commands recorded in this packet manifest."
]'

write_fixture "$core_input_root" test-output/typescript-vitest.txt "synthetic vitest output"
write_fixture "$core_input_root" test-output/python-pytest.txt "synthetic pytest output"
write_fixture "$core_input_root" coverage/typescript/coverage-summary.json '{"total":{"lines":{"pct":100}}}'
write_fixture "$core_input_root" coverage/python/coverage.xml '<coverage branch-rate="1" line-rate="1"></coverage>'
write_fixture "$core_input_root" security/semgrep-report.json '{"results":[],"errors":[]}'
write_fixture "$core_input_root" security/bandit-report.json '{"results":[]}'
write_fixture "$core_input_root" security/trivy-report.json '{"Results":[]}'
write_fixture "$core_input_root" security/sbom.cdx.json '{"bomFormat":"CycloneDX","components":[]}'
write_fixture "$core_input_root" signing/cosign-sign-image.txt "signed"
write_fixture "$core_input_root" signing/cosign-attest-sbom.txt "attested"
write_fixture "$core_input_root" signing/cosign-verify-image.txt "verified image"
write_fixture "$core_input_root" signing/cosign-verify-attestation.txt "verified attestation"

assemble_packet \
  core-case-service \
  backend/core-case-service/Dockerfile \
  "$core_input_root" \
  "$core_output_root" \
  "$core_artifacts_json" \
  "$core_commands_json"

test -f "$core_output_root/manifest.json"
test -f "$core_output_root/reproduce-tagged-build.md"
assert_manifest_artifacts \
  "$core_output_root/manifest.json" \
  core-case-service \
  backend/core-case-service/Dockerfile \
  '[["test-output/typescript-vitest.txt","typescript-vitest-tests"],["test-output/python-pytest.txt","python-pytest-tests"],["coverage/typescript","typescript-vitest-tests"],["coverage/python","python-pytest-tests"],["security/semgrep-report.json","semgrep-source-sast"],["security/bandit-report.json","bandit-python-sast"],["security/trivy-report.json","trivy-image-vulnerability-scan"],["security/sbom.cdx.json","syft-sbom"],["signing/cosign-sign-image.txt","cosign-image-signature"],["signing/cosign-attest-sbom.txt","cosign-sbom-attestation"],["signing/cosign-verify-image.txt","cosign-image-verification"],["signing/cosign-verify-attestation.txt","cosign-attestation-verification"],["reproduce-tagged-build.md","evidence-packet-assembler"]]'

gl_input_root="$runtime_dir/gl-coding/input"
gl_output_root="$runtime_dir/gl-coding/output"
gl_artifacts_json='[
  {"path":"test-output/python-pytest.txt","gate":"python-pytest-tests","description":"Pytest test and coverage command output"},
  {"path":"test-output/provider-pact.txt","gate":"gl-coding-provider-pact","description":"Provider Pact verification output"},
  {"path":"coverage/python","gate":"python-pytest-tests","description":"Coverage report for GL-coding Python sources"},
  {"path":"security/bandit-report.json","gate":"bandit-python-sast","description":"Bandit high-severity Python SAST report"},
  {"path":"security/trivy-report.json","gate":"trivy-image-vulnerability-scan","description":"Trivy critical vulnerability report for the built image"},
  {"path":"security/sbom.cdx.json","gate":"syft-sbom","description":"Syft CycloneDX SBOM for the built image"},
  {"path":"signing/cosign-sign-image.txt","gate":"cosign-image-signature","description":"Cosign image signing command output"},
  {"path":"signing/cosign-attest-sbom.txt","gate":"cosign-sbom-attestation","description":"Cosign SBOM attestation command output"},
  {"path":"signing/cosign-verify-image.txt","gate":"cosign-image-verification","description":"Cosign image signature verification output"},
  {"path":"signing/cosign-verify-attestation.txt","gate":"cosign-attestation-verification","description":"Cosign SBOM attestation verification output"}
]'
gl_commands_json='[
  "Install Node dependencies from the lockfile: `npm ci`.",
  "Install Python dependencies from the lockfile: `uv sync --frozen`.",
  "Run GL-coding tests and coverage: `UV_CACHE_DIR=/tmp/expense-flow-uv-cache uv run pytest tests/test_auth_jwt.py tests/test_expense_line_item.py tests/test_gl_coding.py tests/test_gl_coding_contract.py tests/test_gl_mapping_repository.py tests/test_service_health.py --cov=backend/python --cov-report=term --cov-report=xml:coverage/gl-coding-service/python/coverage.xml --cov-report=html:coverage/gl-coding-service/python/html`.",
  "Run provider Pact verification: `UV_CACHE_DIR=/tmp/expense-flow-uv-cache uv run pytest tests/test_gl_coding_provider_pact.py`.",
  "Build the GL-coding service image: `docker build --file backend/python/Dockerfile --tag gl-coding-service:<tag> .`.",
  "Scan the image with Trivy, generate the Syft SBOM, sign the pushed image with Cosign, attest the SBOM, and verify both using the same commands recorded in this packet manifest."
]'

write_fixture "$gl_input_root" test-output/python-pytest.txt "synthetic pytest output"
write_fixture "$gl_input_root" test-output/provider-pact.txt "synthetic provider pact output"
write_fixture "$gl_input_root" coverage/python/coverage.xml '<coverage branch-rate="1" line-rate="1"></coverage>'
write_fixture "$gl_input_root" security/bandit-report.json '{"results":[]}'
write_fixture "$gl_input_root" security/trivy-report.json '{"Results":[]}'
write_fixture "$gl_input_root" security/sbom.cdx.json '{"bomFormat":"CycloneDX","components":[]}'
write_fixture "$gl_input_root" signing/cosign-sign-image.txt "signed"
write_fixture "$gl_input_root" signing/cosign-attest-sbom.txt "attested"
write_fixture "$gl_input_root" signing/cosign-verify-image.txt "verified image"
write_fixture "$gl_input_root" signing/cosign-verify-attestation.txt "verified attestation"

assemble_packet \
  gl-coding-service \
  backend/python/Dockerfile \
  "$gl_input_root" \
  "$gl_output_root" \
  "$gl_artifacts_json" \
  "$gl_commands_json"

test -f "$gl_output_root/manifest.json"
test -f "$gl_output_root/reproduce-tagged-build.md"
grep -q "gl-coding-service" "$gl_output_root/reproduce-tagged-build.md"
grep -q "backend/python/Dockerfile" "$gl_output_root/reproduce-tagged-build.md"
assert_manifest_artifacts \
  "$gl_output_root/manifest.json" \
  gl-coding-service \
  backend/python/Dockerfile \
  '[["test-output/python-pytest.txt","python-pytest-tests"],["test-output/provider-pact.txt","gl-coding-provider-pact"],["coverage/python","python-pytest-tests"],["security/bandit-report.json","bandit-python-sast"],["security/trivy-report.json","trivy-image-vulnerability-scan"],["security/sbom.cdx.json","syft-sbom"],["signing/cosign-sign-image.txt","cosign-image-signature"],["signing/cosign-attest-sbom.txt","cosign-sbom-attestation"],["signing/cosign-verify-image.txt","cosign-image-verification"],["signing/cosign-verify-attestation.txt","cosign-attestation-verification"],["reproduce-tagged-build.md","evidence-packet-assembler"]]'

rm "$gl_input_root/security/bandit-report.json"

if assemble_packet \
  gl-coding-service \
  backend/python/Dockerfile \
  "$gl_input_root" \
  "$gl_output_root-missing" \
  "$gl_artifacts_json" \
  "$gl_commands_json"; then
  echo "Expected assembler to fail when a required GL-coding artifact is missing." >&2
  exit 1
fi

echo "Service evidence packet contract tests passed."
