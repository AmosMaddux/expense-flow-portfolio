#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
    echo "usage: $0 IMAGE_URI [...]" >&2
    echo "Verifies each image was signed by scripts/aws/build-push-images.sh before deploy." >&2
    exit 2
fi

cosign_bin="${COSIGN_BIN:-cosign}"

if ! command -v "$cosign_bin" >/dev/null 2>&1; then
    echo "$cosign_bin is required to verify release image signatures before deploy." >&2
    exit 1
fi

cosign_args=(verify)

if [[ -n "${COSIGN_KEY:-}" ]]; then
    cosign_args+=(--key "$COSIGN_KEY")
else
    : "${COSIGN_CERTIFICATE_IDENTITY_REGEXP:?COSIGN_CERTIFICATE_IDENTITY_REGEXP must scope verification to the release identity}"
    : "${COSIGN_CERTIFICATE_OIDC_ISSUER:?COSIGN_CERTIFICATE_OIDC_ISSUER must be set}"
    cosign_args+=(
        --certificate-identity-regexp "$COSIGN_CERTIFICATE_IDENTITY_REGEXP"
        --certificate-oidc-issuer "$COSIGN_CERTIFICATE_OIDC_ISSUER"
    )
fi

for image_uri in "$@"; do
    echo "Verifying signature for $image_uri"
    "$cosign_bin" "${cosign_args[@]}" "$image_uri"
done
