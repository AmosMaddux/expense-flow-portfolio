#!/usr/bin/env bash
set -euo pipefail

fixtures_dir="tests/fixtures/iac/reports"
gate_script="scripts/ci/enforce-iac-gates.sh"

expect_success() {
  local name=$1
  shift

  if ! "$@"; then
    echo "Expected success: ${name}" >&2
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
    echo "Expected failure: ${name}" >&2
    exit 1
  fi
}

expect_success "clean Checkov and clean tfsec" \
  "$gate_script" "$fixtures_dir/checkov-clean.json" "$fixtures_dir/tfsec-clean.sarif"

expect_failure "Checkov failed check blocks" \
  "$gate_script" "$fixtures_dir/checkov-failed.json" "$fixtures_dir/tfsec-clean.sarif"

expect_failure "tfsec high finding blocks" \
  "$gate_script" "$fixtures_dir/checkov-clean.json" "$fixtures_dir/tfsec-high.sarif"

expect_success "tfsec medium finding does not block" \
  "$gate_script" "$fixtures_dir/checkov-clean.json" "$fixtures_dir/tfsec-medium.sarif"

expect_failure "tfsec missing severity fails closed" \
  "$gate_script" "$fixtures_dir/checkov-clean.json" "$fixtures_dir/tfsec-missing-severity.sarif"
