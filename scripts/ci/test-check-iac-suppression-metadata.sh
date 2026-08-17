#!/usr/bin/env bash
set -euo pipefail

script="scripts/ci/check-iac-suppression-metadata.sh"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

write_case() {
  local name=$1
  local terraform=$2
  local checkov_config=${3:-"framework:\n  - terraform\n"}

  local case_dir="$tmpdir/$name"
  mkdir -p "$case_dir/infra/terraform" "$case_dir/config"
  printf '%b' "$terraform" > "$case_dir/infra/terraform/main.tf"
  printf '%b' "$checkov_config" > "$case_dir/config/checkov.yaml"
  echo "$case_dir"
}

expect_success() {
  local name=$1
  local case_dir=$2

  if ! IAC_TERRAFORM_ROOT="$case_dir/infra/terraform" CHECKOV_CONFIG_PATH="$case_dir/config/checkov.yaml" IAC_SUPPRESSION_TODAY=2026-08-14 "$script"; then
    echo "Expected metadata validation success: ${name}" >&2
    exit 1
  fi
}

expect_failure() {
  local name=$1
  local case_dir=$2

  set +e
  IAC_TERRAFORM_ROOT="$case_dir/infra/terraform" CHECKOV_CONFIG_PATH="$case_dir/config/checkov.yaml" IAC_SUPPRESSION_TODAY=2026-08-14 "$script"
  local status=$?
  set -e

  if (( status == 0 )); then
    echo "Expected metadata validation failure: ${name}" >&2
    exit 1
  fi
}

valid_checkov=$(write_case valid-checkov 'resource "aws_s3_bucket" "synthetic" {
  #checkov:skip=CKV_AWS_18: Sandbox fixture exception, owner platform-security, review by 2026-12-31
  bucket = "synthetic-fixture-bucket"
}
')
expect_success "valid Checkov suppression" "$valid_checkov"

valid_tfsec=$(write_case valid-tfsec '#tfsec:ignore:aws-s3-enable-bucket-logging Sandbox fixture exception, owner platform-security, review by 2026-12-31
resource "aws_s3_bucket" "synthetic" {
  bucket = "synthetic-fixture-bucket"
}
')
expect_success "valid tfsec suppression" "$valid_tfsec"

missing_owner=$(write_case missing-owner 'resource "aws_s3_bucket" "synthetic" {
  #checkov:skip=CKV_AWS_18: Sandbox fixture exception, review by 2026-12-31
  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "missing owner" "$missing_owner"

missing_review=$(write_case missing-review 'resource "aws_s3_bucket" "synthetic" {
  #checkov:skip=CKV_AWS_18: Sandbox fixture exception, owner platform-security
  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "missing review date" "$missing_review"

expired_review=$(write_case expired-review 'resource "aws_s3_bucket" "synthetic" {
  #checkov:skip=CKV_AWS_18: Sandbox fixture exception, owner platform-security, review by 2026-01-01
  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "expired review date" "$expired_review"

trailing_hcl=$(write_case trailing-hcl 'resource "aws_s3_bucket" "synthetic" {
  #checkov:skip=CKV_AWS_18: Sandbox fixture exception, owner platform-security, review by 2026-12-31  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "HCL trailing suppression metadata" "$trailing_hcl"

bad_checkov_placement=$(write_case bad-checkov-placement '#checkov:skip=CKV_AWS_18: Sandbox fixture exception, owner platform-security, review by 2026-12-31
resource "aws_s3_bucket" "synthetic" {
  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "Checkov suppression outside block" "$bad_checkov_placement"

bad_tfsec_placement=$(write_case bad-tfsec-placement 'resource "aws_s3_bucket" "synthetic" {
  #tfsec:ignore:aws-s3-enable-bucket-logging Sandbox fixture exception, owner platform-security, review by 2026-12-31
  bucket = "synthetic-fixture-bucket"
}
')
expect_failure "tfsec suppression inside block" "$bad_tfsec_placement"

global_skip=$(write_case global-skip 'resource "aws_s3_bucket" "synthetic" {
  bucket = "synthetic-fixture-bucket"
}
' 'framework:\n  - terraform\nskip-check:\n  - CKV_AWS_18\n')
expect_failure "global Checkov skip-check" "$global_skip"