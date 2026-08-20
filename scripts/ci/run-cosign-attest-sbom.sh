#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 IMAGE_REF SBOM_PATH [PREDICATE_TYPE]" >&2
  exit 2
fi

image_ref=$1
sbom_path=$2
predicate_type=${3:-cyclonedx}
cosign_bin="${COSIGN_BIN:-cosign}"

cosign_args=(attest --yes --predicate "$sbom_path" --type "$predicate_type")

if [[ -n "${COSIGN_KEY:-}" ]]; then
  cosign_args+=(--key "$COSIGN_KEY")
fi

"$cosign_bin" "${cosign_args[@]}" "$image_ref"
