# IaC Scanning Suppressions

ExpenseFlow runs Checkov and tfsec against Terraform changes in GitHub Actions.
Checkov blocks on any failed Terraform check. tfsec reports all findings and the
local gate blocks high and critical findings. SARIF upload is used only for
GitHub code scanning visibility; `scripts/ci/enforce-iac-gates.sh` is the gate of
record.

These scanners currently cover Terraform under `infra/terraform/`. Non-Terraform
IaC, such as ECS task-definition JSON files, is outside this scanning scope.

## Suppression Requirements

Use a suppression only when the finding has been reviewed and the risk is
accepted for the sandbox infrastructure boundary. Prefer fixing the Terraform
before suppressing a finding.

Every suppression must include:

- Scanner and check ID.
- Short business or technical rationale.
- Owner responsible for the exception.
- Review-by date.
- Compensating control, when one exists.

Suppressions must be scoped to the smallest Terraform block or line that causes
the finding. Do not add broad directory-wide baselines or global exclusions.
`.checkov.yaml` must not use `skip-check`; use inline suppressions so CI can
validate owner, rationale, review-by date, and placement.

Checkov and tfsec use different placement rules:

- Checkov skips go inside the Terraform block they suppress.
- tfsec ignores go above the Terraform block they suppress.

## Review Process

1. Document the proposed suppression in the pull request description.
2. Link the finding to the Terraform line where the suppression is applied.
3. Obtain approval from a Platform reviewer and a Security reviewer.
4. Remove or renew the suppression before the review-by date.

`.github/CODEOWNERS` requires Platform and Security review for Terraform and
scanning-policy changes. CI runs `scripts/ci/check-iac-suppression-metadata.sh`
to require scanner IDs, owners, non-expired review-by dates, and scanner-specific
placement on suppression comments.

Terraform changes that touch suppressed resources must re-check whether the
suppression is still needed. Stale suppressions should be removed in the same
change.

tfsec was deprecated and folded into Trivy in 2024. ExpenseFlow retains tfsec
because SCRUM-154 acceptance criteria name it directly. Track migration to
`trivy config` in a follow-up ticket while keeping tfsec acceptance coverage
until the acceptance criteria change.

## Examples

Checkov suppressions use the `checkov:skip` format inside the resource block:

```hcl
resource "aws_lb" "public" {
  #checkov:skip=CKV_AWS_91: Sandbox ALB access logs deferred until a log bucket is provisioned, owner platform-security, review by 2026-12-31
  internal           = false
  load_balancer_type = "application"
}
```

tfsec suppressions use the `tfsec:ignore` format above the resource block:

```hcl
#tfsec:ignore:aws-elb-alb-not-public Public API must be internet-facing in sandbox, owner platform-security, review by 2026-12-31
resource "aws_lb" "public" {
  internal           = false
  load_balancer_type = "application"
}
```