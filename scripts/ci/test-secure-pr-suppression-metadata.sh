#!/usr/bin/env bash
set -euo pipefail

script="scripts/ci/check-secure-pr-suppression-metadata.sh"
runtime_dir=$(mktemp -d)
trap 'rm -rf "$runtime_dir"' EXIT

expect_result() {
  local expected=$1
  local name=$2
  local osv_config=$3
  local gitleaks_ignore=$4
  local gitleaks_config=${5:-.gitleaks.toml}

  set +e
  OSV_CONFIG_PATH="$osv_config" \
    GITLEAKS_CONFIG_PATH="$gitleaks_config" \
    GITLEAKS_IGNORE_PATH="$gitleaks_ignore" \
    SECURITY_SUPPRESSION_TODAY=2026-08-19 \
    "$script"
  local status=$?
  set -e

  if [[ "$expected" == success && $status -ne 0 ]] || [[ "$expected" == failure && $status -eq 0 ]]; then
    echo "Expected $expected: $name" >&2
    exit 1
  fi
}

valid_osv="$runtime_dir/valid-osv.toml"
valid_gitleaks="$runtime_dir/valid-gitleaksignore"
cp osv-scanner.toml "$valid_osv"
printf '%s\n' \
  '# owner=platform-security; review-by=2026-11-17; reason=Synthetic fixture is not a credential.' \
  '0123456789012345678901234567890123456789:tests/fixtures/synthetic.txt:generic-api-key:4' \
  > "$valid_gitleaks"
expect_result success "valid suppression metadata" "$valid_osv" "$valid_gitleaks"

missing_owner_osv="$runtime_dir/missing-owner-osv.toml"
sed '/# owner/d' "$valid_osv" > "$missing_owner_osv"
expect_result failure "OSV owner is required" "$missing_owner_osv" "$valid_gitleaks"

expired_osv="$runtime_dir/expired-osv.toml"
sed 's/2026-09-18/2026-08-18/g' "$valid_osv" > "$expired_osv"
expect_result failure "OSV review date cannot be expired" "$expired_osv" "$valid_gitleaks"

broad_osv="$runtime_dir/broad-osv.toml"
printf '%s\n' '[[PackageOverrides]]' 'name = "synthetic"' 'vulnerability.ignore = true' > "$broad_osv"
expect_result failure "broad OSV package suppression is rejected" "$broad_osv" "$valid_gitleaks"

long_lived_osv="$runtime_dir/long-lived-osv.toml"
sed 's/2026-09-18/2027-08-19/g' "$valid_osv" > "$long_lived_osv"
expect_result failure "OSV review date must be time-bounded" "$long_lived_osv" "$valid_gitleaks"

missing_metadata_gitleaks="$runtime_dir/missing-metadata-gitleaksignore"
tail -n 1 "$valid_gitleaks" > "$missing_metadata_gitleaks"
expect_result failure "Gitleaks metadata is required" "$valid_osv" "$missing_metadata_gitleaks"

broad_gitleaks="$runtime_dir/broad-gitleaksignore"
printf '%s\n' \
  '# owner=platform-security; review-by=2026-11-17; reason=Synthetic invalid entry.' \
  'tests/fixtures:generic-api-key:4:extra' \
  > "$broad_gitleaks"
expect_result failure "Gitleaks entry must be a fingerprint" "$valid_osv" "$broad_gitleaks"

broad_gitleaks_config="$runtime_dir/broad-gitleaks.toml"
printf '%s\n' \
  'title = "Synthetic invalid Gitleaks policy"' \
  '[allowlist]' \
  "paths = ['''tests/fixtures/.*''']" \
  > "$broad_gitleaks_config"
expect_result failure "Gitleaks config allowlists are rejected" "$valid_osv" "$valid_gitleaks" "$broad_gitleaks_config"
