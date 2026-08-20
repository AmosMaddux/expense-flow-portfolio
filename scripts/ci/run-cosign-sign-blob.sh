#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 BLOB_PATH [BUNDLE_PATH]" >&2
  exit 2
fi

blob_path=$1
bundle_path=${2:-"$blob_path.cosign.bundle"}
cosign_bin="${COSIGN_BIN:-cosign}"

cosign_args=(sign-blob --yes --bundle "$bundle_path")

if [[ -n "${COSIGN_KEY:-}" ]]; then
  cosign_args+=(--key "$COSIGN_KEY")
fi

"$cosign_bin" "${cosign_args[@]}" "$blob_path"
