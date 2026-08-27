# Secure Release Gate

The Secure Release Gate scans each container image with Trivy, generates a
Syft SBOM, and signs the image and attests the SBOM to it with Cosign before
the image is allowed to reach a runtime environment. It complements the
[Secure PR Gate](secure-pr-gate-suppressions.md), which scans source and
dependencies on every pull request; the release gate scans the built artifact.
A fourth leg, ZAP, runs a DAST baseline scan against the Core Case Service's
deployed sandbox ALB as the last step of a manual sandbox redeploy and fails
that redeploy script on any High-severity finding.

Both service images are covered: `backend/core-case-service/Dockerfile`
(Core Case Service) and `backend/python/Dockerfile` (GL-coding service).

## What runs where

`.github/workflows/secure-release-gate.yml` validates the gate's scripts on
every pull request that touches a Dockerfile, the gate scripts, or their
fixtures. On every push to `main`, its `release-scan` job runs as a matrix
over both service Dockerfiles: it builds the image, runs the Trivy scan and
Syft SBOM, pushes the build to `ghcr.io/<repo>/secure-release-gate/<service>`
as a per-commit evidence image using the workflow's own `GITHUB_TOKEN` (no
extra credentials needed), and then signs and attests _that pushed image_
with Cosign. Signing the pushed image, rather than signing the SBOM alone as
a detached blob, is what cryptographically binds the signature to the exact
scanned artifact digest — a bare SBOM signature does not prove anything about
which image it describes. The job then verifies its own signature and
attestation before finishing, and publishes the Trivy report and SBOM as
workflow artifacts for the evidence packet.

The image that actually reaches ECS is pushed by `scripts/aws/build-push-images.sh`,
for both services. That script runs the same Trivy scan, Syft SBOM
generation, and Cosign signing/attestation against the pushed ECR image
reference, so the artifact ECS runs is scanned and signed at the point it
enters the registry. `scripts/aws/register-task-definitions.sh` runs
`scripts/aws/verify-image-signatures.sh` before it renders task definitions,
so a task definition cannot reference an image whose signature or SBOM
attestation does not verify.

ZAP runs separately from all of the above, and not in `secure-release-gate.yml`'s
`release-scan` job. There is no automated "code merges → service is deployed
and reachable" pipeline in this repo today:
`scripts/aws/e2e/deploy-demo.sh` is a manual, by-hand redeploy of the
Terraform-managed sandbox (`infra/terraform/environments/sandbox`), so ZAP
runs as the last step of that script instead, scanning the public ALB that
redeploy just applied. `secure-release-gate.yml` still validates the ZAP
gate scripts against fixtures on every pull request that touches them (see
`gate-contract-tests`), the same way it validates the Trivy/Syft/Cosign
scripts, but it does not run a scan against a live target.

## Trivy

Trivy scans each image for OS package and application dependency
vulnerabilities and blocks the release on any `CRITICAL` finding
(`scripts/ci/run-trivy-gate.sh`, wrapping `trivy image`). Findings are
reported in JSON so they can be attached to the evidence packet.

## Syft

Syft generates a CycloneDX SBOM for each image (`scripts/ci/run-syft-sbom.sh`,
wrapping `syft`). The SBOM is published as a build artifact and is the
predicate Cosign attests to the image.

## Cosign

Cosign signs the pushed image (`scripts/ci/run-cosign-sign-image.sh`,
wrapping `cosign sign`) and attests the SBOM to it
(`scripts/ci/run-cosign-attest-sbom.sh`, wrapping `cosign attest`). Both
operate on an image reference that already exists in a registry — GHCR for
the CI evidence job, ECR for the real release — so the resulting signature
and attestation are bound to that exact image digest, not to a standalone
file. Signing is keyless by default: it uses the calling identity's GitHub
Actions OIDC token (or, for a local release from
`scripts/aws/build-push-images.sh`, the operator's Sigstore identity) against
the public Fulcio/Rekor instances, so no signing key needs to be stored as a
secret. Set `COSIGN_KEY` (and `COSIGN_PASSWORD` for private keys) to sign
with a key pair instead, for example in an environment without OIDC or
network access to Sigstore.

Verification (`scripts/aws/verify-image-signatures.sh`) runs both
`cosign verify` and `cosign verify-attestation --type cyclonedx` against each
image, so a task definition can't be registered from an image that is signed
but has no verifiable SBOM, or vice versa. It requires
`COSIGN_CERTIFICATE_IDENTITY_REGEXP` and `COSIGN_CERTIFICATE_OIDC_ISSUER` (or
`COSIGN_KEY` for key-based signatures) so a verifier cannot be satisfied by a
signature from an arbitrary identity. Scope the regexp to the identity that
is expected to have produced the release, for example the release script's
own GitHub Actions workflow ref once that pipeline exists, or the release
engineer's Sigstore identity for the current manual sandbox release process.

Blob-signing wrappers (`scripts/ci/run-cosign-sign-blob.sh` /
`run-cosign-verify-blob.sh`) still exist for signing standalone files such as
a report that is not tied to a specific image, but the release gate itself
signs images, not blobs.

## ZAP

ZAP runs a DAST scan against the Core Case Service's deployed public ALB
(`scripts/ci/run-zap-baseline-gate.sh`, wrapping OWASP ZAP's
`zap-api-scan.py`) and blocks on any High-severity alert
(`scripts/ci/check-zap-baseline-severity.sh`, which parses the JSON report's
`riskcode` field rather than trusting `zap-api-scan.py`'s own exit code,
since that code conflates warnings and failures the same way Trivy's default
exit code would without an explicit `--severity`/`--exit-code` pair). The
scan targets the service's live OpenAPI document
(`http://<alb-dns>/v1/openapi.json`, served at `GET /v1/openapi.json` by
Core Case itself) rather than the bare ALB URL: `zap-baseline.py`'s GET-only
link spider cannot discover a JSON REST API's `POST`/`PUT`/`DELETE` routes,
since there is nothing on an unauthenticated root page for it to crawl to,
so it only ever finds the ALB's generic 404 page. `zap-api-scan.py` imports
the OpenAPI document instead and actively calls every route it documents,
which is what actually exercises `/v1/*`.

Both scripts are invoked from `scripts/aws/e2e/deploy-demo.sh` as its final
step, against the OpenAPI document URL built from the same deploy's ALB DNS
name (`terraform output public_alb_dns_name`), and can be skipped with
`SKIP_ZAP_SCAN=true`. The scan runs after the deploy has fully applied, so a
High finding fails the script but does not undo the deploy - see the
"Evidence packet" section below for where the report lands, and the
script's own final-step ordering (summary first, then the severity check)
so the operator still sees the ALB/CloudFront URLs even when the scan fails.

The ZAP container image is pinned by digest via `ZAP_IMAGE`, matching how
`TRIVY_IMAGE` and `SYFT_IMAGE` are pinned in `secure-release-gate.yml`.

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

Each `secure-release-gate` run on `main` uploads a Trivy JSON report and a
Syft CycloneDX SBOM per service as workflow artifacts. `scripts/aws/build-push-images.sh`
writes the same Trivy reports and SBOMs to `evidence/secure-release-gate/`
(see `scripts/aws/README.md`) next to each pushed image reference so they can
be attached to the release's evidence packet; each image's Cosign signature
and SBOM attestation live in the registry alongside the image itself and can
be fetched with `cosign verify` and `cosign verify-attestation`.

`scripts/aws/e2e/deploy-demo.sh` writes its ZAP baseline report to
`evidence/secure-release-gate/core-case-service-zap-report.json` on every
run where `SKIP_ZAP_SCAN` is not set, whether or not a High-severity finding
fails the run - the report is written before the severity check runs, so it
is available in the evidence directory either way. Unlike the Trivy/SBOM
evidence, this is written directly to the local filesystem by the manual
script (there is no `secure-release-gate.yml` workflow artifact for it,
since the scan does not run in CI - see the "ZAP" section above).

The Core Case Service also has a push-triggered CI evidence packet workflow:
`.github/workflows/core-case-evidence-packet.yml`. That packet bundles the
Core Case test output, coverage, Semgrep and Bandit source reports, Trivy image
report, Syft SBOM, Cosign signing and verification output, and a manifest that
maps each artifact to its producing gate. See
`docs/core-case-evidence-packet.md` for the packet contents and tagged-build
reproduction procedure.
