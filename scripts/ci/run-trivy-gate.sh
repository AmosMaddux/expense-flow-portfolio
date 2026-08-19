#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 TRIVY_IMAGE_SCAN_ARGUMENT [...]" >&2
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel)
docker_bin="${TRIVY_DOCKER_BIN:-docker}"
trivy_image="${TRIVY_IMAGE:?TRIVY_IMAGE must be an immutable image reference}"

"$docker_bin" run --rm \
  --volume "$repo_root:/repo" \
  --workdir /repo \
  --entrypoint trivy \
  "$trivy_image" \
  image \
  "$@"
