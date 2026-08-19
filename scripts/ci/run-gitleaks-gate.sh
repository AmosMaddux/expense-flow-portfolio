#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 REPOSITORY BASE_SHA HEAD_SHA" >&2
  exit 2
fi

repository=$1
base_sha=$2
head_sha=$3
repo_root=$(git rev-parse --show-toplevel)
docker_bin="${GITLEAKS_DOCKER_BIN:-docker}"
gitleaks_image="${GITLEAKS_IMAGE:?GITLEAKS_IMAGE must be an immutable image reference}"
gitleaks_args=(
  git "/repo/$repository"
  --log-opts="$base_sha..$head_sha"
  --redact
  --verbose
)

if [[ -n "${GITLEAKS_CONFIG:-}" ]]; then
  gitleaks_args+=(--config "/repo/$GITLEAKS_CONFIG")
fi

"$docker_bin" run --rm \
  --volume "$repo_root:/repo" \
  "$gitleaks_image" \
  "${gitleaks_args[@]}"
