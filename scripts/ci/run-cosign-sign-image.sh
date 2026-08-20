#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 IMAGE_REF" >&2
  exit 2
fi

image_ref=$1
cosign_bin="${COSIGN_BIN:-cosign}"

cosign_args=(sign --yes)

if [[ -n "${COSIGN_KEY:-}" ]]; then
  cosign_args+=(--key "$COSIGN_KEY")
fi

"$cosign_bin" "${cosign_args[@]}" "$image_ref"
