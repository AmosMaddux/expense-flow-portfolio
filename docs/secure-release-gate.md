# Secure Release Gate

The Secure Release Gate scans each container image with Trivy, generates a
Syft SBOM, and signs the image and its SBOM with Cosign before the image is
allowed to reach a runtime environment. It complements the
[Secure PR Gate](secure-pr-gate-suppressions.md), which scans source and
dependencies on every pull request; the release gate scans the built artifact.

## What runs where

`.github/workflows/secure-release-gate.yml` validates the gate's scripts on
every pull request that touches a Dockerfile, the gate scripts, or their
fixtures, and runs the full scan-SBOM-sign sequence against the Core Case
Service image on every push to `main`. That workflow job builds the image
locally, so it does not have credentials for the real container registry; it
publishes the Trivy report and Syft SBOM as workflow artifacts for the
evidence packet, and it signs the SBOM with a keyless Cosign signature scoped
to the workflow's own GitHub Actions OIDC identity, proving the scan and SBOM
came from this pipeline.

The image that actually reaches ECS is pushed by `scripts/aws/build-push-images.sh`.
That script runs the same Trivy scan, Syft SBOM generation, and Cosign signing
against the pushed image reference, so the artifact ECS runs is scanned and
signed at the point it enters the registry. `scripts/aws/register-task-definitions.sh`
runs `scripts/aws/verify-image-signatures.sh` before it renders task
definitions, so a task definition cannot reference an image whose signature
does not verify.

## Trivy

Trivy scans each image for OS package and application dependency
vulnerabilities and blocks the release on any `CRITICAL` finding
(`scripts/ci/run-trivy-gate.sh`, wrapping `trivy image`). Findings are
reported in JSON so they can be attached to the evidence packet.

## Syft

Syft generates a CycloneDX SBOM for each image (`scripts/ci/run-syft-sbom.sh`,
wrapping `syft`). The SBOM is published as a build artifact and is the
predicate Cosign attests against the pushed image.

## Cosign

Cosign signs the pushed image and attests the SBOM to it. Signing is keyless
by default: it uses the calling identity's GitHub Actions OIDC token (or, for
a local release from `scripts/aws/build-push-images.sh`, the operator's
Sigstore identity) against the public Fulcio/Rekor instances, so no signing
key needs to be stored as a secret. Set `COSIGN_KEY` (and `COSIGN_PASSWORD`
for private keys) to sign with a key pair instead, for example in an
environment without OIDC or network access to Sigstore.

Verification (`scripts/aws/verify-image-signatures.sh`, wrapping
`cosign verify`) requires `COSIGN_CERTIFICATE_IDENTITY_REGEXP` and
`COSIGN_CERTIFICATE_OIDC_ISSUER` (or `COSIGN_KEY` for key-based signatures) so
a verifier cannot be satisfied by a signature from an arbitrary identity.
Scope the regexp to the identity that is expected to have produced the
release, for example the release script's own GitHub Actions workflow ref
once that pipeline exists, or the release engineer's Sigstore identity for the
current manual sandbox release process.

## Suppressions

Suppress a specific Trivy CVE only after the Security team confirms it is a
false positive or accepts a time-bounded risk. Add the exact CVE ID to the
root `.trivyignore`, immediately preceded by one metadata comment line:

```text
# owner=platform-security; review-by=2026-11-17; reason=Synthetic example: vulnerable code path is not reachable at runtime; tracked for upgrade in SCRUM-000.
CVE-2026-00001
```

`scripts/ci/check-secure-release-suppression-metadata.sh` fails the gate when
a suppression is missing owner, review-by, or reason metadata, when the
review-by date is expired or more than 90 days out, or when an entry is not a
CVE ID. Remove the suppression once the underlying finding is fixed, and
repeat the review before the review-by date if it is still needed.

## Evidence packet

Each `secure-release-gate` run on `main` uploads the Trivy JSON report, the
Syft CycloneDX SBOM, and the Cosign signature bundle as workflow artifacts.
`scripts/aws/build-push-images.sh` writes the Trivy report and SBOM to
`evidence/secure-release-gate/` (see `scripts/aws/README.md`) next to the
pushed image reference so they can be attached to the release's evidence
packet; the image's Cosign signature and SBOM attestation live in the
registry alongside the image itself and can be fetched with `cosign verify`
and `cosign verify-attestation`.
