#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 [--output REPORT_PATH] TARGET [...]" >&2
  exit 2
fi

report_path=""
if [[ "${1:-}" == "--output" ]]; then
  if [[ $# -lt 3 ]]; then
    echo "usage: $0 [--output REPORT_PATH] TARGET [...]" >&2
    exit 2
  fi
  report_path=$2
  shift 2
fi

bandit_bin="${BANDIT_BIN:-bandit}"
bandit_args=(-r "$@" --severity-level high)

if [[ -n "$report_path" ]]; then
  bandit_args+=(--format json --output "$report_path")
fi

"$bandit_bin" "${bandit_args[@]}"
