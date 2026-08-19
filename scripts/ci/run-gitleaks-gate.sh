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
gitleaks_config="${GITLEAKS_CONFIG:-.gitleaks.toml}"
gitleaks_args=(
  git "/repo/$repository"
  --config "/repo/$gitleaks_config"
  --log-opts="$base_sha..$head_sha"
  --gitleaks-ignore-path "/repo/${GITLEAKS_IGNORE_PATH:-.gitleaksignore}"
  --ignore-gitleaks-allow
  --redact
  --verbose
)

"$docker_bin" run --rm \
  --volume "$repo_root:/repo" \
  "$gitleaks_image" \
  "${gitleaks_args[@]}"
