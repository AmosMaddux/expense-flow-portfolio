#!/usr/bin/env bash
set -euo pipefail

script="scripts/ci/check-zap-baseline-severity.sh"
fixtures_dir="tests/fixtures/security/zap"

expect_success() {
  local name=$1
  shift

  if ! "$@" >/dev/null 2>&1; then
    echo "Expected success: $name" >&2
    exit 1
  fi
}

expect_failure() {
  local name=$1
  shift

  set +e
  "$@" >/dev/null 2>&1
  local status=$?
  set -e

  if (( status == 0 )); then
    echo "Expected failure: $name" >&2
    exit 1
  fi
}

expect_failure "High-risk alert fails the gate" \
  "$script" "$fixtures_dir/high-risk.json"

expect_success "Medium/Low-only alerts pass the gate" \
  "$script" "$fixtures_dir/medium-low-only.json"

expect_success "Zero alerts pass the gate" \
  "$script" "$fixtures_dir/no-alerts.json"

expect_failure "Missing scanned site results fail safe" \
  "$script" "$fixtures_dir/missing-site.json"

expect_failure "Empty scanned site results fail safe" \
  "$script" "$fixtures_dir/empty-site.json"

expect_failure "Malformed JSON fails safe" \
  "$script" "$fixtures_dir/malformed.json"

expect_failure "Empty report file fails safe" \
  "$script" "$fixtures_dir/empty.json"

expect_failure "Missing report file fails safe" \
  "$script" "$fixtures_dir/does-not-exist.json"

echo "All ZAP baseline gate tests passed."
