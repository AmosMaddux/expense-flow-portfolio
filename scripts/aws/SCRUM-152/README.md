# SCRUM-152 SPA-to-backend CORS

SCRUM-152 configures the public Core Case service behind the ALB as the SPA backend. The JWT-probe API Gateway is intentionally not used as `VITE_API_BASE_URL`; it does not expose the application's `/v1/*` surface.

Core Case permits one `SPA_ORIGIN`, returns credentialed CORS headers for that exact origin, and answers preflight before authentication middleware. This supports the SPA's `credentials: "include"` login and refresh flow while denying other browser origins.

## Deploy the backend dependency

Build and publish the updated Core Case image, then register and deploy its ECS task with the CloudFront origin:

```bash
SPA_ORIGIN="https://dzw2h7jwg14u1.cloudfront.net" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/register-task-definitions.sh

AWS_PROFILE=expenseflow-smoke \
scripts/aws/deploy-services.sh
```

The existing runtime scripts require their normal networking, database, Redis, secret, image and certificate inputs. This ticket must not synthesize those later backend dependencies.

## Deploy the SPA

`BACKEND_BASE_URL` must be the certificate-valid HTTPS origin of the public Core Case ALB. It must not contain `/v1`; frontend requests already include that prefix. Before rebuilding the SPA, the script verifies that the backend publishes the real application OpenAPI surface and the credentialed CloudFront-origin preflight policy.

```bash
BACKEND_BASE_URL="https://api.sandbox.example.invalid" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-152/deploy-spa-api-cors.sh
```

The script then delegates to SCRUM-151 to build and sync the SPA and invalidate CloudFront.

## Verify

Use only a current token for a synthetic sandbox identity. The token is written to a mode-`600` temporary curl configuration, is never printed, and is removed on exit.

```bash
BACKEND_BASE_URL="https://api.sandbox.example.invalid" \
VALID_ACCESS_TOKEN='synthetic-sandbox-access-token' \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-152/verify-spa-api-cors.sh
```

Verification requires all of the following:

- Core Case exposes `/v1/auth/login` and `/v1/case-queue/line-items`;
- the exact CloudFront origin receives a credentialed login preflight;
- an unrelated origin receives no allow-origin header;
- the deployed SPA contains the backend origin without a duplicated `/v1`; and
- an authenticated request reaches a real `/v1/case-queue/line-items` application route.

If `VALID_ACCESS_TOKEN` is unavailable because the backend login/database dependency is not deployed, the script exits with status `2` and explicitly reports the acceptance smoke as incomplete.
