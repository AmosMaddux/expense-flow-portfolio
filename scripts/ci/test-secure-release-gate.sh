#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
runtime_dir="$repo_root/.secure-release-gate-contract"
fixtures_dir="$repo_root/tests/fixtures/security/trivy"

: "${TRIVY_IMAGE:?TRIVY_IMAGE must be an immutable image reference}"
: "${SYFT_IMAGE:?SYFT_IMAGE must be an immutable image reference}"

cleanup() {
  docker rmi --force secure-release-gate-fixture-clean:test secure-release-gate-fixture-vulnerable:test >/dev/null 2>&1 || true
  rm -rf "$runtime_dir"
}
trap cleanup EXIT

expect_success() {
  local name=$1
  shift

  if ! "$@"; then
    echo "Expected success: $name" >&2
    exit 1
  fi
}

expect_failure() {
  local name=$1
  shift

  set +e
  "$@"
  local status=$?
  set -e

  if (( status == 0 )); then
    echo "Expected failure: $name" >&2
    exit 1
  fi
}

mkdir -p "$runtime_dir"

docker build --quiet \
  --file "$fixtures_dir/clean.Dockerfile" \
  --tag secure-release-gate-fixture-clean:test \
  "$fixtures_dir" >/dev/null
docker save secure-release-gate-fixture-clean:test -o "$runtime_dir/clean.tar"

docker build --quiet \
  --file "$fixtures_dir/vulnerable.Dockerfile" \
  --tag secure-release-gate-fixture-vulnerable:test \
  "$fixtures_dir" >/dev/null
docker save secure-release-gate-fixture-vulnerable:test -o "$runtime_dir/vulnerable.tar"

expect_success "Trivy clean fixture" \
  "$repo_root/scripts/ci/run-trivy-gate.sh" \
    --input .secure-release-gate-contract/clean.tar \
    --severity CRITICAL \
    --exit-code 1 \
    --format json \
    --output .secure-release-gate-contract/clean-report.json

expect_failure "Trivy vulnerable fixture" \
  "$repo_root/scripts/ci/run-trivy-gate.sh" \
    --input .secure-release-gate-contract/vulnerable.tar \
    --severity CRITICAL \
    --exit-code 1 \
    --format json \
    --output .secure-release-gate-contract/vulnerable-report.json

expect_failure "Trivy execution error" \
  env TRIVY_DOCKER_BIN=missing-docker-command \
  "$repo_root/scripts/ci/run-trivy-gate.sh" --input .secure-release-gate-contract/clean.tar

expect_success "Syft clean fixture produces an SBOM" \
  "$repo_root/scripts/ci/run-syft-sbom.sh" \
    docker-archive:/repo/.secure-release-gate-contract/clean.tar \
    -o cyclonedx-json=/repo/.secure-release-gate-contract/sbom.cdx.json

node -e '
const fs = require("node:fs");
const sbom = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (sbom.bomFormat !== "CycloneDX") {
  throw new Error("SBOM is missing CycloneDX bomFormat");
}
if (!Array.isArray(sbom.components ?? [])) {
  throw new Error("SBOM components, if present, must be an array");
}
' "$runtime_dir/sbom.cdx.json"

expect_failure "Syft execution error" \
  env SYFT_DOCKER_BIN=missing-docker-command \
  "$repo_root/scripts/ci/run-syft-sbom.sh" \
    docker-archive:/repo/.secure-release-gate-contract/clean.tar \
    -o cyclonedx-json=/repo/.secure-release-gate-contract/error.json

cosign_key_dir="$runtime_dir/cosign-keys"
mkdir -p "$cosign_key_dir"
( cd "$cosign_key_dir" && COSIGN_PASSWORD="" cosign generate-key-pair >/dev/null )

expect_success "Cosign signs the SBOM" \
  env COSIGN_KEY="$cosign_key_dir/cosign.key" COSIGN_PASSWORD="" \
    "$repo_root/scripts/ci/run-cosign-sign-blob.sh" "$runtime_dir/sbom.cdx.json"

expect_success "Cosign verifies the signed SBOM" \
  env COSIGN_KEY="$cosign_key_dir/cosign.pub" \
    "$repo_root/scripts/ci/run-cosign-verify-blob.sh" \
    "$runtime_dir/sbom.cdx.json" "$runtime_dir/sbom.cdx.json.cosign.bundle"

cp "$runtime_dir/sbom.cdx.json" "$runtime_dir/sbom.cdx.tampered.json"
printf '\n// tampered\n' >> "$runtime_dir/sbom.cdx.tampered.json"

expect_failure "Cosign rejects a tampered SBOM" \
  env COSIGN_KEY="$cosign_key_dir/cosign.pub" \
    "$repo_root/scripts/ci/run-cosign-verify-blob.sh" \
    "$runtime_dir/sbom.cdx.tampered.json" "$runtime_dir/sbom.cdx.json.cosign.bundle"

expect_failure "Cosign verify requires scoped identity metadata when keyless" \
  "$repo_root/scripts/ci/run-cosign-verify-blob.sh" \
    "$runtime_dir/sbom.cdx.json" "$runtime_dir/sbom.cdx.json.cosign.bundle"
