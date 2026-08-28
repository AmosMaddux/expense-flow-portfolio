# 0008. Run a ZAP DAST baseline scan from the sandbox redeploy script, not the Secure Release Gate workflow

- Status: Accepted
- Date: 2026-08-24
- Decision makers/Desired reviewer count: TBD
- Related: [Secure Release Gate](../secure-release-gate.md), [0005. Manage sandbox AWS infrastructure with Terraform](0005-manage-sandbox-aws-infrastructure-with-terraform.md)

## Context

The Secure Release Gate (`docs/secure-release-gate.md`, `.github/workflows/secure-release-gate.yml`) covers three legs today: Trivy scans a built image for known CVEs, Syft generates its SBOM, and Cosign signs the image and attests the SBOM. All three operate on a container image as a static artifact — something that exists on disk or in a registry, with no service listening on a port. SCRUM-160 asked for a fourth leg: a DAST baseline scan with OWASP ZAP, which is different in kind. ZAP does not scan a file; it sends real HTTP requests to a running service and inspects the responses (missing security headers, verbose error pages, reflected input, and similar runtime-observable issues that a static image scan cannot see). It needs a live, network-reachable target, not an artifact.

That requirement collides with how this repository actually gets code into a running state. There is no automated path from "a commit merges to `main`" to "the Core Case Service is deployed and reachable." `scripts/aws/e2e/deploy-demo.sh` is the only thing that stands up or updates the sandbox — Terraform-managed (ADR 0005), invoked by hand from an operator's machine with the `expenseflow-smoke` AWS profile, running a real `terraform apply` against real, billed AWS infrastructure that nothing tears down afterward. `secure-release-gate.yml`'s `release-scan` job builds and scans an image locally in the runner and, on push to `main`, pushes that build to GHCR as a per-commit evidence artifact — it does not deploy to ECS, does not touch the sandbox, and stands up no listening service.

The public Core Case Service ALB (`infra/terraform/modules/alb`) is internet-reachable — its security group opens port 80 (and 443 when a certificate is configured) to `0.0.0.0/0`, deliberately, for "external employee portal smoke testing" (see the `tfsec`/`checkov` suppression comments on `aws_vpc_security_group_ingress_rule.public_alb_http`). A GitHub-hosted runner can reach it directly; no VPC networking workaround is needed. The GL-coding service, by contrast, sits behind the *internal* ALB with no public ingress rule at all, so it is not reachable from a hosted runner regardless of trigger model. This ADR is scoped to Core Case, the only target that is both reachable and named in the SCRUM-160 acceptance criteria.

## Decision

ZAP runs as the last step of `scripts/aws/e2e/deploy-demo.sh`, immediately after the script's Terraform apply and bastion-driven migrate/seed steps, against the public ALB DNS name that same run just produced (`terraform output public_alb_dns_name`). It does not run in `secure-release-gate.yml`.

`scripts/ci/run-zap-baseline-gate.sh` wraps `zap-baseline.py` (image pinned by digest via `ZAP_IMAGE`, matching how `TRIVY_IMAGE`/`SYFT_IMAGE` are pinned) and writes a JSON report; it does not decide pass/fail, mirroring how `run-trivy-gate.sh` is a thin wrapper with severity passed in by the caller. `scripts/ci/check-zap-baseline-severity.sh` parses that report and fails (exit 1) on any alert with `riskcode "3"` (High), printing name/risk/URL for each to stderr — the same "parse the report, don't trust the tool's own exit code" shape as the rest of the gate, since `zap-baseline.py`'s exit code conflates WARN and FAIL the way an unqualified Trivy exit code would without an explicit `--severity`. The report lands at `evidence/secure-release-gate/core-case-service-zap-report.json`, in the same evidence directory Trivy/SBOM reports use, so it is discoverable the same way even though nothing uploads it as a GitHub Actions artifact. `SKIP_ZAP_SCAN=true` opts a given run out entirely.

The severity check is deliberately deferred past the script's final summary print rather than run inline where step 8 sits. By the time ZAP runs, the deploy has already fully applied — the ALB, ECS services, and CloudFront are live and billing regardless of what the scan finds. Failing immediately inside `set -euo pipefail` would abort the script before the operator ever saw the ALB URL, the CloudFront URL, or the "nothing was torn down, this is billed" warning printed at the end — exactly the information most needed when something has gone wrong. The script now captures the severity check's exit status, prints the full summary unconditionally, and only then exits non-zero if a High finding was found.

`secure-release-gate.yml`'s `gate-contract-tests` job still validates the ZAP gate scripts against fixtures (`scripts/ci/test-zap-baseline-gate.sh`, `tests/fixtures/security/zap/`) on every pull request that touches them, exactly as it validates the Trivy/Syft/Cosign scripts. What it does not do is run a scan against a live target — there is nothing running-and-reachable for it to scan from that job's context.

### Why not the workflow

Putting the ZAP step inside `release-scan`, or a sibling job triggered on push to `main`, was considered and rejected for two independent reasons, either one sufficient on its own:

**There is no target in that job's context.** `release-scan` builds an image, saves it to a tarball, and scans the tarball — it launches no listening service. Giving ZAP something to scan would mean adding a `docker run -d -p ... "$IMAGE_REF"` step that none of the other three tools need, and Core Case cannot run standalone: it needs a real Postgres, a JWT issuer, and other environment-wired dependencies that `deploy-demo.sh` assembles across several steps (see that script's own step list). Building a throwaway deployment inside the CI runner just to give ZAP a URL is materially more machinery than the scan itself, is not the fourth leg matched to the other three, and duplicates infrastructure Terraform already owns (ADR 0005).

**Scanning the persistent sandbox on every push would scan stale code.** The alternative — skip standing up a fresh target, point ZAP at the already-running sandbox ALB instead — reintroduces the gap this decision exists to avoid. A push to `main` does not redeploy the sandbox; the ALB reflects whatever the last manual `deploy-demo.sh` run put there, which may be several merges behind the commit that triggered the workflow. A scan under those conditions produces a pass/fail signal attached to the wrong commit: a merge could be reported clean because the *old* deployment had no High findings, or blocked by a finding that has nothing to do with the code just merged. Running the scan from inside `deploy-demo.sh` instead ties every scan to the deployment that specifically caused it — the ALB DNS name it reads is the output of the `terraform apply` in the same script invocation, so the finding is always about the code that is actually live.

Both problems trace back to the same root cause: this repository has no automated deploy pipeline. `push`-to-`main` in `secure-release-gate.yml` means "an image was scanned, signed, and pushed to GHCR as evidence," never "the sandbox now runs this commit." Wiring ZAP to that trigger would be gating on an event that does not imply the precondition ZAP actually needs (something new and reachable to scan). Gating on "a redeploy just happened," which only `deploy-demo.sh` knows in the moment, is the only trigger that is true when the scan runs.

## Consequences

Positive:

- Every ZAP scan is guaranteed to run against the deployment that produced its target URL, not an unrelated or stale one — there is no window where the report could be about different code than what is actually live.
- No new CI infrastructure (throwaway container networking, service dependencies, VPC reachability workarounds) had to be built to give ZAP something to scan.
- The gate scripts (`run-zap-baseline-gate.sh`, `check-zap-baseline-severity.sh`) are pure and reusable — nothing about them assumes they run in GitHub Actions specifically, so moving them into a workflow later, if the trigger problem is ever solved, is a wiring change, not a rewrite.
- A High finding still leaves the operator with full deploy output (ALB/CloudFront URLs, the "nothing was torn down" warning) before the script exits non-zero, instead of aborting mid-deploy on a `set -e` trip.

Negative:

- The scan only runs when a human remembers to run `deploy-demo.sh`, or explicitly runs the gate scripts by hand — there is no scheduled or event-driven backstop that catches a High finding introduced by, say, an infrastructure change applied outside a full redeploy.
- The ZAP report is not a GitHub Actions workflow artifact the way the Trivy/SBOM evidence is. It exists only on whichever machine ran the deploy, under `evidence/secure-release-gate/`, unless that operator commits or otherwise ships it. There is no centralized, browsable history of ZAP runs the way there is for `release-scan`'s per-commit evidence.
- `SKIP_ZAP_SCAN=true` is trivially available to any operator, with no gate forcing its use to be justified or reviewed the way a `.trivyignore` suppression is.
- GL-coding is out of scope entirely — it has no public ingress, so this decision does not give it DAST coverage, and a future ADR would be needed if that becomes a requirement.

Neutral:

- This decision is provisional on the deploy pipeline staying manual. If `deploy-demo.sh` (or a successor) becomes CI-driven — an automated apply on push to `main`, or a workflow-dispatched deploy — the trigger problem this ADR describes goes away, and moving the ZAP step into that same workflow, right after the deploy step, becomes the natural fourth leg alongside Trivy/Syft/Cosign. Revisit then.
- No suppression mechanism (a `.trivyignore`-equivalent for ZAP) exists yet. This was deferred pending a real dry run against the live sandbox turning up persistent false positives worth suppressing, rather than built speculatively.

## Alternatives Considered

**Add a `zap-baseline-scan` job to `secure-release-gate.yml`, triggered on push to `main`, scanning the freshly built image.** Rejected: `release-scan` never launches a listening service, and Core Case cannot run standalone without a database, JWT issuer, and other dependencies `deploy-demo.sh` wires up across multiple steps. Reproducing that inside the CI runner is a bigger, more fragile undertaking than the scan itself, and is out of proportion to what SCRUM-160 asked for.

**Add the same job, but scan the persistent sandbox ALB instead of a freshly built image.** Rejected: push-to-`main` does not redeploy the sandbox, so the scan would run against whatever code was last manually deployed — possibly several commits behind the one that triggered the workflow. This produces a pass/fail result attached to the wrong commit, which is worse than not gating on push at all.

**Add a `workflow_dispatch`-triggered workflow, run manually right after `deploy-demo.sh` finishes.** Keeps the scan in GitHub Actions and produces a proper artifact, but requires the operator to remember and execute a second, separate manual step after the deploy — easier to forget than a step already embedded in the script the operator is already running, and does not improve on the current approach's core guarantee (scan reflects the deployment that just happened) while adding a step that can silently be skipped.

**Schedule a recurring `secure-release-gate.yml` job against the sandbox (e.g., nightly).** Would provide the "backstop" this ADR's negative consequences flag as missing. Rejected for now because it reintroduces the staleness problem in a different form — a nightly scan says nothing about which commit is actually live at the time it runs unless the sandbox's current image tag is captured and cross-checked — and because it adds a second ZAP entry point to maintain (schedule wiring, secrets for a shared target) before the primary one has been dry-run against production-like findings. Worth reconsidering once Step 10 of the SCRUM-160 plan (a real dry run tuning the baseline ruleset) is done and the false-positive rate is known.
