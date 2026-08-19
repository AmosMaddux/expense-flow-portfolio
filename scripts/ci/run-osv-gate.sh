#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 OSV_SCAN_ARGUMENT [...]" >&2
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel)
docker_bin="${OSV_DOCKER_BIN:-docker}"
osv_image="${OSV_IMAGE:?OSV_IMAGE must be an immutable image reference}"

"$docker_bin" run --rm \
  --volume "$repo_root:/repo" \
  --workdir /repo \
  --entrypoint osv-scanner \
  "$osv_image" \
  scan source \
  "$@"
