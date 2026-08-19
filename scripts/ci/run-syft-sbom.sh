#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 SYFT_ARGUMENT [...]" >&2
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel)
docker_bin="${SYFT_DOCKER_BIN:-docker}"
syft_image="${SYFT_IMAGE:?SYFT_IMAGE must be an immutable image reference}"

"$docker_bin" run --rm \
  --volume "$repo_root:/repo" \
  --workdir /repo \
  --entrypoint /syft \
  "$syft_image" \
  "$@"
