#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 NAME:RESULT [...]" >&2
  exit 2
fi

failed=0

for check_result in "$@"; do
  check_name="${check_result%%:*}"
  result="${check_result#*:}"

  if [[ -z "$check_name" || "$result" == "$check_result" ]]; then
    echo "Invalid gate result: $check_result" >&2
    failed=1
  elif [[ "$result" != "success" ]]; then
    if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
      echo "::error::$check_name finished with result: $result"
    else
      echo "ERROR: $check_name finished with result: $result" >&2
    fi
    failed=1
  fi
done

exit "$failed"
