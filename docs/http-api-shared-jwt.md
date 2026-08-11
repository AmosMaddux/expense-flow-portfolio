# HTTP API shared JWT authorizer

The platform stack in `platform/http-api/template.yaml` provisions an API Gateway HTTP API with a native JWT authorizer. Every route inherits the authorizer unless a future route explicitly overrides it. The included `/auth-context` probe confirms that API Gateway passed verified `tenant_id` and `roles` claims to Lambda without returning the tenant identifier.

## Prerequisites

The deployed core API must use the same values supplied to the stack:

- `AUTH_JWT_ISSUER` must be its public HTTPS issuer URL, including `/v1` when that is the externally routed service base. The issuer must remain reachable by API Gateway.
- `AUTH_JWT_AUDIENCE` defaults to `expenseflow-http-api`.
- `GET {issuer}/.well-known/openid-configuration` must return the issuer and `jwks_uri`.
- `GET {issuer}/.well-known/jwks.json` must be publicly reachable and include the active RSA public key identified by the token's `kid`. Keep the prior key published during rotation because API Gateway can cache keys.

Private signing keys stay with the core API. Do not put a private key, token, customer identifier, or production value in SAM configuration or source control.

## Build and deploy

Deployment changes AWS resources and requires AWS credentials, AWS SAM CLI, an artifact bucket managed by SAM, and permission to manage CloudFormation, API Gateway, Lambda, CloudWatch Logs, S3 deployment artifacts, and bounded IAM execution roles. Each Lambda role uses the account-managed `TraineeSandboxBoundary`, trusts only Lambda, and attaches only `AWSLambdaBasicExecutionRole`. Review each changeset before execution.

```bash
cd platform/http-api
sam validate --lint
sam build
sam deploy --guided \
  --parameter-overrides \
    EnvironmentTag=sandbox \
    UserTag=muhilramesh \
    JwtIssuer=https://core-api.example.invalid/v1 \
    JwtAudience=expenseflow-http-api \
    StageName=v1
```

The command returns `ProtectedClaimsProbeUrl`. No deployment is performed by repository tests.

## Deployed smoke test

Use only synthetic, non-production identities. Supply a current access token from the core API and an intentionally expired token signed by the same non-production issuer. The script creates the tampered case in memory, does not print tokens, and checks that rejected responses do not contain the Lambda invocation marker.

```bash
HTTP_API_PROBE_URL=https://api-id.execute-api.us-east-1.amazonaws.com/v1/auth-context \
VALID_ACCESS_TOKEN='synthetic-valid-token' \
EXPIRED_ACCESS_TOKEN='synthetic-expired-token' \
./scripts/smoke-test-http-api-jwt.sh
```

Expected result: the valid token returns `200`; the expired and tampered tokens return `401` from API Gateway before the probe Lambda runs.
