#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 TARGET [REPORT_PATH]" >&2
  exit 2
fi

target=$1
report_path=${2:-semgrep-results.json}
semgrep_bin="${SEMGREP_BIN:-semgrep}"
semgrep_config="${SEMGREP_CONFIG:-p/typescript}"
semgrep_args=(
  scan
  --config "$semgrep_config"
  --severity ERROR
  --json-output "$report_path"
  --metrics off
)

if [[ "${SEMGREP_NO_GIT_IGNORE:-false}" == "true" ]]; then
  semgrep_args+=(--no-git-ignore)
fi

"$semgrep_bin" "${semgrep_args[@]}" "$target"

python3 - "$report_path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as report:
    payload = json.load(report)

errors = [
    error
    for error in payload.get("errors", [])
    if str(error.get("level", "")).lower() == "error"
]
if errors:
    raise SystemExit(f"Semgrep reported {len(errors)} blocking scan error(s).")

findings = payload.get("results", [])
if findings:
    raise SystemExit(f"Semgrep reported {len(findings)} blocking finding(s).")
PY
