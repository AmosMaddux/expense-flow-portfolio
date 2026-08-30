# SCRUM-151 SPA CDN Scripts

These Bash scripts build the Vite SPA, sync it to a private S3 bucket, serve it through CloudFront with origin access control (OAC), configure SPA deep-link fallback, and invalidate the CloudFront cache after each deployment.

## Defaults

- AWS profile: `expenseflow-smoke`
- AWS region: `us-east-1`
- S3 bucket: `expenseflow-sandbox-spa-<account-id>-us-east-1`
- CloudFront comment: `ExpenseFlow SCRUM-151 sandbox SPA`
- OAC name: `expenseflow-scrum-151-<account-id>-spa-oac`
- SCRUM-151-owned resource tags: `user=muhilramesh`, `env=sandbox`, `ticket=SCRUM-151`
- SPA fallback: CloudFront `403` and `404` responses return `/index.html` with HTTP `200`

The bucket blocks all public access and grants `s3:GetObject` only to the ticket's CloudFront distribution through a source-ARN-scoped bucket policy. Existing dependency-bucket tags and policy statements are preserved. The distribution redirects HTTP to HTTPS and uses AWS's managed `CachingOptimized` cache policy.

Before `s3 sync --delete`, the deployment script verifies the bucket's SCRUM-151 approval tags, the distribution's ownership tags, and that the distribution has exactly one matching OAC-backed origin. OAC reuse also requires the expected always-signed SigV4 S3 configuration. Teardown refuses to delete an OAC while any distribution still references it.

## Prerequisites

Run from the repository root with AWS CLI v2, Node.js, npm, and curl installed. Authenticate the sandbox profile first:

```bash
aws login --profile expenseflow-smoke
aws sts get-caller-identity --profile expenseflow-smoke --region us-east-1
```

## Script Order

Create or secure the private bucket, then create or update the OAC, distribution, and bucket policy:

```bash
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-151/create-spa-cdn-resources.sh
```

Build, sync, set cache metadata, and invalidate CloudFront:

```bash
VITE_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com" \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-151/deploy-spa.sh
```

`VITE_API_BASE_URL` is optional and defaults to an empty value for local same-origin proxy workflows. In the Terraform-managed sandbox split, supply the `core_case_api_gateway_base_url` output so `/v1/*` calls bypass CloudFront, keep real API `403` and `404` responses, and avoid browser mixed-content blocking. The public HTTP ALB remains directly reachable as the API Gateway integration target in this small sandbox setup; a future private version should use API Gateway VPC Link to the internal ALB. The deployment gives hashed Vite assets a one-year immutable cache lifetime, gives other files a one-hour lifetime, and prevents caching `index.html` so new asset references are discovered immediately.

Verify bucket privacy, OAC, both fallback mappings, the deployed root page, and a synthetic deep link:

```bash
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-151/verify-spa-cdn.sh
```

The first CloudFront deployment can take several minutes. If verification reports a status other than `Deployed`, wait for deployment and rerun it:

```bash
aws cloudfront wait distribution-deployed \
  --profile expenseflow-smoke \
  --id "<distribution-id>"
```

## Overrides

The scripts create or reuse `expenseflow-sandbox-spa-<account-id>-<region>` by default and include the required sandbox tags in the `CreateBucket` request. Set `SPA_BUCKET_NAME` and `CREATE_SPA_BUCKET=false` to consume a bucket provisioned by S3-EF-021 instead. Use `DISTRIBUTION_ID` to target a known SCRUM-151 distribution during deploy and verification. The create script uses the stable distribution comment to update a prior run instead of creating duplicates.

## Teardown

The guarded teardown verifies SCRUM-151 ownership tags before deleting the distribution. It deletes the bucket only when the create script created and tagged that bucket as SCRUM-151-owned; an S3-EF-021 dependency bucket is left intact. CloudFront must disable and deploy the distribution before deletion, so teardown can take several minutes.

```bash
CONFIRM_RESOURCE_TEARDOWN=SCRUM-151 \
AWS_PROFILE=expenseflow-smoke \
scripts/aws/SCRUM-151/tear-down-spa-cdn-resources.sh
```

The teardown leaves a shared S3-EF-021 bucket and its objects intact.
