#!/usr/bin/env bash
set -euo pipefail

script="scripts/ci/check-secure-release-suppression-metadata.sh"
runtime_dir=$(mktemp -d)
trap 'rm -rf "$runtime_dir"' EXIT

expect_result() {
  local expected=$1
  local name=$2
  local trivyignore=$3

  set +e
  TRIVYIGNORE_PATH="$trivyignore" \
    SECURITY_SUPPRESSION_TODAY=2026-08-19 \
    "$script"
  local status=$?
  set -e

  if [[ "$expected" == success && $status -ne 0 ]] || [[ "$expected" == failure && $status -eq 0 ]]; then
    echo "Expected $expected: $name" >&2
    exit 1
  fi
}

valid="$runtime_dir/valid-trivyignore"
printf '%s\n' \
  '# owner=platform-security; review-by=2026-11-17; reason=Synthetic fixture; fix scheduled.' \
  'CVE-2026-00001' \
  > "$valid"
expect_result success "valid suppression metadata" "$valid"

missing_metadata="$runtime_dir/missing-metadata-trivyignore"
tail -n 1 "$valid" > "$missing_metadata"
expect_result failure "metadata is required" "$missing_metadata"

expired="$runtime_dir/expired-trivyignore"
sed 's/2026-11-17/2026-08-18/g' "$valid" > "$expired"
expect_result failure "review date cannot be expired" "$expired"

long_lived="$runtime_dir/long-lived-trivyignore"
sed 's/2026-11-17/2027-08-19/g' "$valid" > "$long_lived"
expect_result failure "review date must be time-bounded" "$long_lived"

not_a_cve="$runtime_dir/not-a-cve-trivyignore"
printf '%s\n' \
  '# owner=platform-security; review-by=2026-11-17; reason=Synthetic invalid entry.' \
  'GHSA-synthetic-example' \
  > "$not_a_cve"
expect_result failure "entry must be a CVE identifier" "$not_a_cve"

missing_file="$runtime_dir/does-not-exist-trivyignore"
expect_result failure "missing file fails closed" "$missing_file"
