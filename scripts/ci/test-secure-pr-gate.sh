#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
runtime_dir="$repo_root/.secure-pr-gate-contract"
fixtures_dir="$repo_root/tests/fixtures/security"

: "${ACTIONLINT_IMAGE:?ACTIONLINT_IMAGE must be an immutable image reference}"
: "${GITLEAKS_IMAGE:?GITLEAKS_IMAGE must be an immutable image reference}"
: "${OSV_IMAGE:?OSV_IMAGE must be an immutable image reference}"
: "${SEMGREP_IMAGE:?SEMGREP_IMAGE must be an immutable image reference}"

cleanup() {
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

mkdir -p \
  "$runtime_dir/semgrep" \
  "$runtime_dir/bandit" \
  "$runtime_dir/osv/clean" \
  "$runtime_dir/osv/empty" \
  "$runtime_dir/osv/vulnerable" \
  "$runtime_dir/osv/suppressed" \
  "$runtime_dir/gitleaks"

cp "$fixtures_dir/semgrep/clean.ts.txt" "$runtime_dir/semgrep/clean.ts"
cp "$fixtures_dir/semgrep/vulnerable.ts.txt" "$runtime_dir/semgrep/vulnerable.ts"
cp "$fixtures_dir/bandit/clean.py.txt" "$runtime_dir/bandit/clean.py"
cp "$fixtures_dir/bandit/vulnerable.py.txt" "$runtime_dir/bandit/vulnerable.py"
cp "$fixtures_dir/osv/clean-package-lock.json.txt" "$runtime_dir/osv/clean/package-lock.json"
cp "$fixtures_dir/osv/vulnerable-package-lock.json.txt" "$runtime_dir/osv/vulnerable/package-lock.json"
cp "$fixtures_dir/osv/vulnerable-package-lock.json.txt" "$runtime_dir/osv/suppressed/package-lock.json"
cp "$repo_root/osv-scanner.toml" "$runtime_dir/osv/suppressed/osv-scanner.toml"

expect_success "workflow syntax" \
  docker run --rm --volume "$repo_root:/repo" --workdir /repo \
    "$ACTIONLINT_IMAGE" .github/workflows/secure-pr-gate.yml

semgrep_container=(
  docker run --rm
  --volume "$repo_root:/src"
  --workdir /src
  --entrypoint bash
  --env SEMGREP_NO_GIT_IGNORE=true
  "$SEMGREP_IMAGE"
)
expect_success "Semgrep clean fixture" \
  "${semgrep_container[@]}" /src/scripts/ci/run-semgrep-gate.sh \
    .secure-pr-gate-contract/semgrep/clean.ts \
    .secure-pr-gate-contract/semgrep/clean.json
expect_failure "Semgrep vulnerable fixture" \
  "${semgrep_container[@]}" /src/scripts/ci/run-semgrep-gate.sh \
    .secure-pr-gate-contract/semgrep/vulnerable.ts \
    .secure-pr-gate-contract/semgrep/vulnerable.json
expect_failure "Semgrep execution error" \
  docker run --rm --volume "$repo_root:/src" --workdir /src --entrypoint bash \
    --env SEMGREP_CONFIG=/src/.secure-pr-gate-contract/missing-semgrep-config.yml \
    "$SEMGREP_IMAGE" /src/scripts/ci/run-semgrep-gate.sh \
    .secure-pr-gate-contract/semgrep/clean.ts \
    .secure-pr-gate-contract/semgrep/error.json

expect_success "Bandit clean fixture" \
  "$repo_root/scripts/ci/run-bandit-gate.sh" "$runtime_dir/bandit/clean.py"
expect_failure "Bandit vulnerable fixture" \
  "$repo_root/scripts/ci/run-bandit-gate.sh" "$runtime_dir/bandit/vulnerable.py"
expect_failure "Bandit execution error" \
  env BANDIT_BIN=missing-bandit-command \
    "$repo_root/scripts/ci/run-bandit-gate.sh" "$runtime_dir/bandit/clean.py"

expect_success "OSV clean fixture" \
  "$repo_root/scripts/ci/run-osv-gate.sh" \
    --lockfile .secure-pr-gate-contract/osv/clean/package-lock.json
expect_failure "OSV vulnerable fixture" \
  "$repo_root/scripts/ci/run-osv-gate.sh" \
    --lockfile .secure-pr-gate-contract/osv/vulnerable/package-lock.json
expect_success "OSV suppression fixture" \
  "$repo_root/scripts/ci/run-osv-gate.sh" \
    --lockfile .secure-pr-gate-contract/osv/suppressed/package-lock.json
expect_failure "OSV execution error" \
  "$repo_root/scripts/ci/run-osv-gate.sh" --invalid-secure-gate-test-option
expect_failure "OSV missing lockfiles fails closed" \
  "$repo_root/scripts/ci/run-osv-gate.sh" \
    .secure-pr-gate-contract/osv/empty

git -C "$runtime_dir/gitleaks" init --quiet
git -C "$runtime_dir/gitleaks" config user.name "ExpenseFlow Security Fixture"
git -C "$runtime_dir/gitleaks" config user.email "security-fixture@example.invalid"
cp "$fixtures_dir/gitleaks/clean.txt" "$runtime_dir/gitleaks/fixture.txt"
git -C "$runtime_dir/gitleaks" add fixture.txt
git -C "$runtime_dir/gitleaks" commit --quiet -m "clean fixture base"
gitleaks_base=$(git -C "$runtime_dir/gitleaks" rev-parse HEAD)
cp "$fixtures_dir/gitleaks/clean-second.txt" "$runtime_dir/gitleaks/fixture.txt"
git -C "$runtime_dir/gitleaks" add fixture.txt
git -C "$runtime_dir/gitleaks" commit --quiet -m "clean fixture head"
gitleaks_clean_head=$(git -C "$runtime_dir/gitleaks" rev-parse HEAD)

expect_success "Gitleaks clean commit range" \
  env GITLEAKS_CONFIG=tests/fixtures/security/gitleaks/gitleaks.toml \
    "$repo_root/scripts/ci/run-gitleaks-gate.sh" \
    .secure-pr-gate-contract/gitleaks "$gitleaks_base" "$gitleaks_clean_head"

cp "$fixtures_dir/gitleaks/vulnerable.txt" "$runtime_dir/gitleaks/fixture.txt"
git -C "$runtime_dir/gitleaks" add fixture.txt
git -C "$runtime_dir/gitleaks" commit --quiet -m "synthetic vulnerable fixture"
gitleaks_vulnerable_head=$(git -C "$runtime_dir/gitleaks" rev-parse HEAD)

expect_failure "Gitleaks vulnerable commit range" \
  env GITLEAKS_CONFIG=tests/fixtures/security/gitleaks/gitleaks.toml \
    "$repo_root/scripts/ci/run-gitleaks-gate.sh" \
    .secure-pr-gate-contract/gitleaks "$gitleaks_clean_head" "$gitleaks_vulnerable_head"
expect_failure "Gitleaks execution error" \
  env GITLEAKS_DOCKER_BIN=missing-docker-command \
    "$repo_root/scripts/ci/run-gitleaks-gate.sh" \
    .secure-pr-gate-contract/gitleaks "$gitleaks_clean_head" "$gitleaks_vulnerable_head"

expect_success "aggregate accepts successful scanners" \
  "$repo_root/scripts/ci/enforce-secure-pr-gate-results.sh" \
    Contract:success Semgrep:success Bandit:success OSV:success Gitleaks:success

for scanner in Semgrep Bandit OSV Gitleaks; do
  expect_failure "aggregate rejects $scanner failure" \
    "$repo_root/scripts/ci/enforce-secure-pr-gate-results.sh" \
      Contract:success "$scanner:failure"
done
