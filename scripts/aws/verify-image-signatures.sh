#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
    echo "usage: $0 IMAGE_URI [...]" >&2
    echo "Verifies each image's Cosign signature and CycloneDX SBOM attestation from scripts/aws/build-push-images.sh before deploy." >&2
    exit 2
fi

cosign_bin="${COSIGN_BIN:-cosign}"
attestation_type="${COSIGN_ATTESTATION_TYPE:-cyclonedx}"

if ! command -v "$cosign_bin" >/dev/null 2>&1; then
    echo "$cosign_bin is required to verify release image signatures before deploy." >&2
    exit 1
fi

identity_args=()

if [[ -n "${COSIGN_KEY:-}" ]]; then
    identity_args+=(--key "$COSIGN_KEY")
else
    : "${COSIGN_CERTIFICATE_IDENTITY_REGEXP:?COSIGN_CERTIFICATE_IDENTITY_REGEXP must scope verification to the release identity}"
    : "${COSIGN_CERTIFICATE_OIDC_ISSUER:?COSIGN_CERTIFICATE_OIDC_ISSUER must be set}"
    identity_args+=(
        --certificate-identity-regexp "$COSIGN_CERTIFICATE_IDENTITY_REGEXP"
        --certificate-oidc-issuer "$COSIGN_CERTIFICATE_OIDC_ISSUER"
    )
fi

for image_uri in "$@"; do
    echo "Verifying signature for $image_uri"
    "$cosign_bin" verify "${identity_args[@]}" "$image_uri"

    echo "Verifying $attestation_type SBOM attestation for $image_uri"
    "$cosign_bin" verify-attestation --type "$attestation_type" "${identity_args[@]}" "$image_uri"
done
