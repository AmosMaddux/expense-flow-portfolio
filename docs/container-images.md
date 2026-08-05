# Service container images

ExpenseFlow deploys the Core Case and GL-coding services as separate images. Build from the repository root so each Dockerfile receives the lockfile and workspace files it expects.

## GL-coding service

Build the FastAPI image with:

```sh
docker build --file backend/python/Dockerfile --tag expenseflow-gl-coding:local .
```

Release builds must also set the platform selected by the ECS task definition,
for example `--platform linux/amd64`; use `linux/arm64` only for an ARM64 task.
Do not build an ECS release image implicitly for the developer workstation's
architecture.

The builder installs the exact production dependency graph from `uv.lock` with `uv sync --frozen --no-dev`. The runtime stage contains only Python, the resulting virtual environment, and `backend/python`; it does not contain `uv`, test dependencies, repository history, or frontend and Node files. The service runs as the unprivileged numeric user `10001` and exposes port `8001`.

The dependency layer copies only `pyproject.toml` and `uv.lock` before running `uv sync`. Source-only changes therefore reuse the dependency layer. Dependency changes invalidate that layer intentionally. `.dockerignore` keeps local environments, build output, tests, documentation, and package caches out of the build context.

For local verification, generate the synthetic development JWT configuration described in the root README, then run:

```sh
docker compose up --build --wait gl-coding
docker inspect --format '{{.State.Health.Status}}' expense-flow-project-team-3-gl-coding-1
curl --fail http://localhost:8001/health
```

The Dockerfile health check uses Python's standard library, so no HTTP client is installed solely for health checking. ECS can use the same command and `/health` endpoint.

## Core Case service

The companion Node-service ticket supplies
`backend/core-case-service/Dockerfile`. Once that file is present, build it
from the same root context with:

```sh
docker build --file backend/core-case-service/Dockerfile --tag expenseflow-core-case:local .
```

Its dependency layer should copy the root and Core Case `package.json` files plus `package-lock.json` before `npm ci`. Its build stage compiles TypeScript, and its runtime stage should copy only production dependencies, compiled output, and required migration assets. This ordering lets source-only changes reuse the npm dependency layer and keeps TypeScript sources, tests, and build tooling out of the runtime image.

## Recording image size

Image size depends on the target architecture and base-image revision, so record the immutable image digest, platform, and size together after each release build:

```sh
docker image inspect expenseflow-gl-coding:local --format 'GL-coding {{.Id}} {{.Architecture}} {{.Size}} bytes'
docker image inspect expenseflow-core-case:local --format 'Core Case {{.Id}} {{.Architecture}} {{.Size}} bytes'
docker history expenseflow-gl-coding:local
docker history expenseflow-core-case:local
```

The reported byte count is the local uncompressed size. Registry and ECS transfer sizes are compressed and can differ. Comparing `docker history` between releases identifies unexpected layer growth while preserving an architecture-aware measurement instead of a stale hard-coded number.
