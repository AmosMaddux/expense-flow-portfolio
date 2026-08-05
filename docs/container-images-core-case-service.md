# Core Case service container image

ExpenseFlow packages the Core Case Service as a separate Node image. Build from
the repository root so the Dockerfile receives the root lockfile, npm workspace
metadata, and TypeScript configuration it expects.

Build the image with:

```sh
docker build --file backend/core-case-service/Dockerfile --tag expenseflow-core-case:local .
```

Release builds must also set the platform selected by the ECS task definition,
for example `--platform linux/amd64`; use `linux/arm64` only for an ARM64 task.
Do not build an ECS release image implicitly for the developer workstation's
architecture.

The Dockerfile uses the digest-pinned `node:24-bookworm-slim` image for the
dependency, build, production dependency, and runtime stages. Node 24 matches
the repository engine requirement, while the Debian slim variant keeps the image
smaller than the full Bookworm image without taking on Alpine musl compatibility
risk for native runtime packages such as `argon2`. Pinning the base image by
digest makes a given source revision build against the same base layers until
the digest is intentionally updated.

The dependency stage copies the root `package.json`, `package-lock.json`,
workspace package manifests, and TypeScript configuration before running
`npm ci`. Source-only changes therefore reuse the dependency layer. Dependency
or workspace manifest changes invalidate that layer intentionally. The build
stage then copies the Core Case Service source and compiles TypeScript with the
workspace build script.

The production dependency stage performs a clean `npm ci --omit=dev` so the
runtime image does not inherit TypeScript, Vitest, Playwright, testcontainers,
or other development tooling. The runtime stage copies only production
dependencies, the package metadata required for npm workspace module
resolution, compiled `dist` output, and `backend/core-case-service/drizzle`.
Some production dependencies are installed under the service workspace's local
`node_modules`, so the runtime stage copies both root and service-local
production dependency directories.

Migration files are included as versioned release assets, but normal web
containers do not run migrations by default. The image sets
`AUTO_APPLY_MIGRATIONS=false` so ECS service tasks can start without attempting
schema changes during scale-out or rolling deployments. A later one-off ECS
migration task or managed release step can use the same image with explicit
runtime configuration to apply the Drizzle migrations that match the deployed
service version.

The root Compose service deliberately uses `CORE_CASE_LOCAL_APPLY_MIGRATIONS`
as a local-only switch and defaults it to `true` so `docker compose up
core-case-service` can initialize a fresh local PostgreSQL database. Do not
reuse that local Compose default for ECS service tasks. Production-like service
tasks should keep `AUTO_APPLY_MIGRATIONS=false` and run migrations through a
separate release step.

Runtime configuration comes from environment variables, not image layers. Do not
bake `.env`, credentials, JWT key material, AWS secrets, database URLs, or
private identifiers into the image. The root `.dockerignore` keeps local
environment files, repository history, local dependency directories, build
output, coverage, and test artifacts out of the build context.

The service runs as the unprivileged `node` user and exposes port `3000`. The
Dockerfile health check uses Node's built-in `fetch` to request `/health`, so no
HTTP client package is installed solely for health checking. ECS can override
the Dockerfile health check if the task definition or ALB rollout policy needs
different intervals, timeouts, or grace periods.

For local verification, generate the synthetic development configuration
described in the root README, then run:

```sh
docker build --file backend/core-case-service/Dockerfile --tag expenseflow-core-case:local .
docker run --rm --env-file .env -e PORT=3000 -e AUTO_APPLY_MIGRATIONS=false -p 3301:3000 expenseflow-core-case:local
curl --fail http://localhost:3301/health
```

To verify the packaged health check and migration assets from another shell
while the container is running:

```sh
docker ps --filter ancestor=expenseflow-core-case:local
docker exec <container-id> test -d /workspace/backend/core-case-service/drizzle
```

## Recording image size

Image size depends on the target architecture and base-image revision, so record
the immutable image digest, platform, and size together after each release
build:

```sh
docker image inspect expenseflow-core-case:local --format 'Core Case {{.Id}} {{.Architecture}} {{.Size}} bytes'
docker history expenseflow-core-case:local
```

The reported byte count is the local uncompressed size. Registry and ECS
transfer sizes are compressed and can differ. Comparing `docker history` between
releases identifies unexpected layer growth while preserving an
architecture-aware measurement instead of a stale hard-coded number.
