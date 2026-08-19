#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 BLOB_PATH BUNDLE_PATH" >&2
  exit 2
fi

blob_path=$1
bundle_path=$2
cosign_bin="${COSIGN_BIN:-cosign}"

cosign_args=(verify-blob --bundle "$bundle_path")

if [[ -n "${COSIGN_KEY:-}" ]]; then
  cosign_args+=(--key "$COSIGN_KEY")
else
  : "${COSIGN_CERTIFICATE_IDENTITY_REGEXP:?COSIGN_CERTIFICATE_IDENTITY_REGEXP must scope keyless verification to the release identity}"
  : "${COSIGN_CERTIFICATE_OIDC_ISSUER:?COSIGN_CERTIFICATE_OIDC_ISSUER must be set}"
  cosign_args+=(
    --certificate-identity-regexp "$COSIGN_CERTIFICATE_IDENTITY_REGEXP"
    --certificate-oidc-issuer "$COSIGN_CERTIFICATE_OIDC_ISSUER"
  )
fi

"$cosign_bin" "${cosign_args[@]}" "$blob_path"
