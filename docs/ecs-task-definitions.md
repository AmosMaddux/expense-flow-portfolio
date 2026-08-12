# ECS Fargate task definitions

ExpenseFlow defines lightweight ECS Fargate task-definition templates for the
Core Case Service and GL-coding service under `infra/ecs/task-definitions`.
Temporary Bash scripts under `scripts/aws/` create the sandbox ALBs, target
groups, ECS services, and smoke paths around those task definitions. They
intentionally do not introduce Terraform, CDK, or CloudFormation.

Build release images from the existing Dockerfiles, push them to ECR, and then
replace the image placeholders with immutable ECR image URIs or digests before
registering the task definitions. Build with the same platform as the task
runtime, currently `linux/amd64` for the `X86_64` task definitions.

```sh
docker build --platform linux/amd64 --file backend/core-case-service/Dockerfile --tag "${CORE_CASE_IMAGE_URI}" .
docker build --platform linux/amd64 --file backend/python/Dockerfile --tag "${GL_CODING_IMAGE_URI}" .
```

## Runtime shape

Both tasks use Fargate, `awsvpc` networking, Linux `X86_64`, `512` CPU units,
and `1024` MiB of memory.

The Core Case Service task exposes port `3000` and checks `/health` with Node's
built-in `fetch`. It keeps `AUTO_APPLY_MIGRATIONS=false` so web service scale-out
and rolling deployments do not run schema changes. Run Drizzle migrations as a
separate release step or one-off ECS task using the same image version.

The GL-coding service task exposes port `8001` and checks `/health` with
Python's standard library. It receives verification key material only.

The sandbox ECS services attach both tasks to ALB target groups. The public HTTP
listener routes `/v1/*` to Core Case. GL-coding attaches to a separate internal
ALB target group so Core Case can call GL-coding through a VPC-internal load
balancer without making GL-coding part of the public `/v1` API surface.

These sandbox scripts do not configure ECS Service Auto Scaling. Each service
uses the configured desired count, which defaults to one task, and ECS replaces
unhealthy tasks through the service scheduler and ALB health checks.

The Core Case task template keeps `RUNTIME_SMOKE_GL_CODING_ENABLED` render-time
configurable and defaults it to `false` in the registration script. Sandbox ALB
smoke runs must explicitly render it as `true`; the endpoint also requires a
Secrets Manager-backed runtime smoke token.

## Placeholder reference

Replace these placeholders before registration:

| Placeholder | Type | Used by |
| --- | --- | --- |
| `${AWS_REGION}` | Config | Both task definitions |
| `${AUTH_JWT_KEY_ID}` | Config | Both services |
| `${CORE_CASE_IMAGE_URI}` | ECR image URI or digest | Core Case |
| `${GL_CODING_IMAGE_URI}` | ECR image URI or digest | GL-coding |
| `${ECS_TASK_EXECUTION_ROLE_ARN}` | IAM role ARN | Both task definitions |
| `${CORE_CASE_TASK_ROLE_ARN}` | IAM role ARN | Core Case |
| `${GL_CODING_TASK_ROLE_ARN}` | IAM role ARN | GL-coding |
| `${CORE_CASE_LOG_GROUP_NAME}` | CloudWatch Logs group | Core Case |
| `${GL_CODING_LOG_GROUP_NAME}` | CloudWatch Logs group | GL-coding |
| `${CORE_CASE_DATABASE_URL_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${GL_CODING_DATABASE_URL_SECRET_ARN}` | Secrets Manager ARN | GL-coding |
| `${CORE_CASE_AUTH_JWT_PRIVATE_KEY_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${GL_CODING_AUTH_JWT_PUBLIC_KEYS_JSON_SECRET_ARN}` | Secrets Manager ARN | GL-coding |
| `${CORE_CASE_MFA_TOTP_SECRET_ENCRYPTION_KEY_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${CORE_CASE_RUNTIME_SMOKE_SHARED_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${CORE_CASE_TIN_EIN_VALIDATION_USERNAME_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${CORE_CASE_TIN_EIN_VALIDATION_PASSWORD_SECRET_ARN}` | Secrets Manager ARN | Core Case |
| `${DYNAMODB_EXPENSE_REPORT_TABLE}` | Config | Core Case |
| `${DYNAMODB_EXPENSE_REPORT_TENANT_INDEX}` | Config | Core Case |
| `${GL_CODING_SERVICE_BASE_URL}` | Config | Core Case |
| `${MFA_TOTP_SECRET_KEY_VERSION}` | Config | Core Case |
| `${RECEIPT_STORAGE_BUCKET}` | Config | Core Case |
| `${REDIS_URL}` | Config | Core Case |
| `${RUNTIME_SMOKE_GL_CODING_ENABLED}` | Config | Core Case |
| `${STAGE_TRANSITION_SNS_TOPIC_ARN}` | Config | Core Case |
| `${TIN_EIN_VALIDATION_ENDPOINT_URL}` | Config | Core Case |
| `${TIN_EIN_VALIDATION_WSDL_URL}` | Config | Core Case |

The Node Core Case task receives the JWT signing private key through
`AUTH_JWT_PRIVATE_KEY_BASE64`. Verifier services receive
`AUTH_JWT_PUBLIC_KEYS_JSON`, which supports key rotation and matches the later
RS256/JWKS migration direction. Do not place key material, database URLs, or
external credentials in image layers, task-definition environment values, logs,
or documentation.
