# 0005. Manage sandbox AWS infrastructure with Terraform

- Status: Accepted
- Date: 2026-08-13
- Related: [0004. Run containerized services on ECS Fargate](0004-run-containerized-services-on-ecs-fargate.md), [ECS task definitions](../ecs-task-definitions.md)

## Context

ExpenseFlow previously used temporary Bash scripts under `scripts/aws/` to create sandbox AWS resources for container image smoke checks, ALB-backed ECS services, and SPA CDN hosting. Those scripts proved the runtime architecture, but they did not provide a durable infrastructure-as-code boundary, a shared reviewable plan, or a consistent remote state workflow.

The platform now needs reproducible Terraform for the first AWS sandbox environment. The scope includes VPC networking, public and internal load balancing, ECS Fargate services for Core Case and GL-coding, and private S3 plus CloudFront hosting for the SPA. Terraform state must be stored remotely before the rest of the infrastructure is managed, and any data stores created by the module must declare encryption at rest in Terraform.

The sandbox account already contained some manually created resources from earlier work. Discovery found an existing non-default VPC and default VPC, but the new Terraform implementation is the authoritative path for new contract-compliant sandbox infrastructure rather than importing those older resources by default.

## Decision

ExpenseFlow will manage the sandbox networking, compute, and SPA hosting infrastructure with Terraform under `infra/terraform`.

Terraform is split into a bootstrap root and a sandbox environment root. The bootstrap root creates the remote Terraform state data store first: an encrypted, versioned S3 bucket and an encrypted DynamoDB table. The sandbox root then uses the S3 backend with Terraform's native S3 lockfile support.

The sandbox root composes reusable modules:

- `modules/network` provisions a new VPC, public subnets, private subnets, an internet gateway, and route tables.
- `modules/alb` provisions the public Core Case ALB, internal GL-coding ALB, target groups, listeners, listener rules, and ALB security groups.
- `modules/ecs` provisions the ECS Fargate cluster, task definitions, ECS services, ECR repositories, CloudWatch log groups, IAM roles, task security groups, SNS topic, encrypted receipt bucket, and encrypted DynamoDB Expense Report read-projection table.
- `modules/spa` provisions the private encrypted SPA S3 bucket, CloudFront origin access control, CloudFront distribution, SPA fallback responses, and a source-ARN-scoped bucket policy.

The Terraform provider applies default sandbox tags to taggable resources:

- `user=DonovanRodgers`
- `env=sandbox`

Secrets are represented as Secrets Manager ARN inputs only. Terraform files and tfvars must not contain database URLs, credentials, keys, tokens, or other secret values.

The public ALB supports an optional ACM certificate ARN. When a certificate is supplied, HTTP redirects to HTTPS and `/v1` plus `/v1/*` route to Core Case through HTTPS listener rules. When no certificate is supplied, the sandbox can still produce a reviewable plan and a basic HTTP listener for early infrastructure validation.

CI will run Terraform formatting and validation for both roots. When AWS role credentials are configured for the repository, CI will initialize the sandbox remote backend and produce a reviewable Terraform plan artifact for pull requests.

## Consequences

The platform gains a reproducible infrastructure boundary for the AWS sandbox instead of relying on imperative scripts as the long-term source of truth.

Remote state is available before the rest of the infrastructure is planned or applied. This reduces local-state drift and gives the team a shared backend for future Terraform changes.

Networking, ALB, ECS, runtime dependencies, and SPA hosting can now be reviewed as code. The Terraform plan is reviewable in CI, which makes infrastructure changes more visible before apply.

Data stores created in this Terraform scope explicitly enforce encryption at rest. This includes the Terraform state bucket, Terraform lock table, SPA bucket, receipt bucket, and Expense Report DynamoDB projection table.

The implementation creates a fresh Terraform-managed sandbox VPC by default. Existing manually created resources are not automatically imported, so any decision to reuse prior resources must be made explicitly through import work or future variables.

The current ECS service definitions can create infrastructure before runnable images and all secret ARNs are supplied, but a successful Terraform apply does not by itself prove that the application services can pass health checks. Image publishing, secret creation, database reachability, Redis reachability, and service smoke checks remain separate release activities.

## Alternatives Considered

### Continue With Bash Scripts

The existing AWS scripts are useful for smoke validation and teardown, but they do not give the team a declarative desired state, remote backend workflow, module boundaries, or a stable CI plan review path. Continuing with scripts would keep infrastructure behavior harder to review and easier to drift.

### Import Existing Sandbox Resources First

Importing the existing sandbox VPC and related resources would avoid creating some new AWS resources. It was not chosen as the default because discovery showed earlier resources with tag ownership that does not match the new Terraform ownership model. Import remains an option if the team later decides that an existing resource must be preserved.

### Single Flat Terraform Root

A single Terraform root would be simpler at first, but it would mix remote-state bootstrapping with the infrastructure that depends on that state. Splitting bootstrap from the sandbox root keeps the required data store creation order explicit and makes future environments easier to add.
