#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --target URL --output JSON_REPORT_PATH [-- ZAP_BASELINE_ARGUMENT [...]]" >&2
}

target=""
output=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$target" || -z "$output" ]]; then
  usage
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel)
docker_bin="${ZAP_DOCKER_BIN:-docker}"
zap_image="${ZAP_IMAGE:?ZAP_IMAGE must be an immutable image reference}"

report_dir=$(dirname "$output")
report_name=$(basename "$output")
mkdir -p "$repo_root/$report_dir"

# zap-baseline.py always exits non-zero when it finds WARN/FAIL alerts, which
# conflates "scan completed and found something" with "scan itself failed to
# run" - the caller (scripts/ci/check-zap-baseline-severity.sh) decides
# pass/fail from the report contents, not this exit code.
set +e
"$docker_bin" run --rm \
  --volume "$repo_root/$report_dir:/zap/wrk:rw" \
  --entrypoint zap-baseline.py \
  "$zap_image" \
  -t "$target" \
  -J "$report_name" \
  "$@"
run_status=$?
set -e

if [[ ! -f "$repo_root/$report_dir/$report_name" ]]; then
  echo "ZAP baseline scan did not produce a report at $output (zap-baseline.py exit code $run_status)." >&2
  exit 1
fi

exit 0
