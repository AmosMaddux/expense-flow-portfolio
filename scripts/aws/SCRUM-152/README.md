# SCRUM-152 SPA-to-backend CORS

These scripts configure the shared API Gateway HTTP API for the exact CloudFront SPA origin, deploy the Vite SPA with that API stage as `VITE_API_BASE_URL`, and verify allowed, denied, and authenticated browser-origin requests.

## Deploy

Authenticate the sandbox profile, then run from the repository root:

```bash
aws login --profile expenseflow-smoke
AWS_PROFILE=expenseflow-smoke scripts/aws/SCRUM-152/deploy-spa-api-cors.sh
```

The deploy packages the SAM template with the AWS CLI and updates the existing `expenseflow-http-api-sandbox` CloudFormation stack, preserving its deployed JWT issuer, audience, and stage. API Gateway handles preflight without invoking protected routes. The CORS policy allows only the HTTPS CloudFront origin, the browser methods used by the BFF, and the `Authorization` and `Content-Type` request headers. It does not enable credentialed cookie requests.

The script then calls the SCRUM-151 deployment to rebuild and sync the SPA with the API Gateway stage URL and invalidate CloudFront.

## Verify

Use a current access token for a synthetic sandbox identity. The script stores the token only in a mode-`600` temporary curl configuration, never prints it, and deletes the temporary directory on exit.

```bash
VALID_ACCESS_TOKEN='synthetic-sandbox-access-token' \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-152/verify-spa-api-cors.sh
```

Verification proves that:

- the CloudFront origin receives a successful preflight with the exact allow-origin value;
- an unrelated origin receives no allow-origin header;
- the deployed Vite asset contains the expected API stage URL; and
- an authenticated SPA-origin request reaches the JWT-protected `/auth-context` Lambda and receives the SPA CORS header.

If `VALID_ACCESS_TOKEN` is omitted, the script completes the non-secret CORS and bundle checks and exits with status `2` to show that the authenticated acceptance smoke remains outstanding.
