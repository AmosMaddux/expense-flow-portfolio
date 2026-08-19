#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 TARGET [...]" >&2
  exit 2
fi

bandit_bin="${BANDIT_BIN:-bandit}"
"$bandit_bin" -r "$@" --severity-level high
