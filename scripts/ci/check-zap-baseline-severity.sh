#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 ZAP_JSON_REPORT_PATH" >&2
  exit 2
fi

report="$1"

if [[ ! -s "$report" ]]; then
  echo "ZAP report not found or empty: $report" >&2
  exit 1
fi

if ! jq empty "$report" >/dev/null 2>&1; then
  echo "ZAP report is not valid JSON: $report" >&2
  exit 1
fi

# ZAP's riskcode is a string ("0"=Info, "1"=Low, "2"=Medium, "3"=High).
high_alerts=$(jq -c '[.site[]?.alerts[]? | select(.riskcode == "3")]' "$report")
high_count=$(echo "$high_alerts" | jq 'length')

if [[ "$high_count" -eq 0 ]]; then
  echo "No High-severity ZAP alerts found."
  exit 0
fi

echo "ZAP baseline scan found $high_count High-severity alert(s):" >&2
echo "$high_alerts" | jq -r '.[] | "- \(.name) [\(.riskdesc)]\n" + (.instances[]? | "    \(.method) \(.uri)")' >&2

exit 1
