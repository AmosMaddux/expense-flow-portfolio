#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 --target OPENAPI_SPEC_URL --output JSON_REPORT_PATH [-- ZAP_API_SCAN_ARGUMENT [...]]" >&2
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

docker_bin="${ZAP_DOCKER_BIN:-docker}"
zap_image="${ZAP_IMAGE:?ZAP_IMAGE must be an immutable image reference}"

report_dir=$(dirname "$output")
report_name=$(basename "$output")
mkdir -p "$report_dir"
report_dir=$(cd "$report_dir" && pwd)

# zap-baseline.py's GET-only link spider can't discover a JSON REST API's
# POST/PUT/DELETE routes - it only ever finds whatever an unauthenticated
# root page happens to link to. zap-api-scan.py imports the service's
# OpenAPI document instead and actively calls every documented route, which
# is the only way this actually exercises Core Case's real /v1/* surface
# rather than just the ALB's generic 404 page. $target is the OpenAPI
# document URL (e.g. http://<alb-dns>/v1/openapi.json), not the bare host.
#
# zap-api-scan.py always exits non-zero when it finds WARN/FAIL alerts,
# which conflates "scan completed and found something" with "scan itself
# failed to run" - the caller (scripts/ci/check-zap-baseline-severity.sh)
# decides pass/fail from the report contents, not this exit code.
set +e
"$docker_bin" run --rm \
  --volume "$report_dir:/zap/wrk:rw" \
  --entrypoint zap-api-scan.py \
  "$zap_image" \
  -t "$target" \
  -f openapi \
  -J "$report_name" \
  "$@"
run_status=$?
set -e

if [[ ! -f "$report_dir/$report_name" ]]; then
  echo "ZAP API scan did not produce a report at $output (zap-api-scan.py exit code $run_status)." >&2
  exit 1
fi

exit 0
