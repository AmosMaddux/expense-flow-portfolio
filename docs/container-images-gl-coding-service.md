# GL-coding service container image

Build from the repository root so the Dockerfile receives the lockfile and
workspace files it expects.

Build the FastAPI image with:

```sh
docker build --file backend/python/Dockerfile --tag expenseflow-gl-coding:local .
```

Release builds must also set the platform selected by the ECS task definition,
for example `--platform linux/amd64`; use `linux/arm64` only for an ARM64 task.
Do not build an ECS release image implicitly for the developer workstation's
architecture.

The builder installs the exact production dependency graph from `uv.lock` with `uv sync --frozen --no-dev`. The `uv` and Python base-image tags are also pinned to immutable multi-architecture manifest digests. Dependabot checks the Dockerfile weekly so base-image security updates remain explicit source changes. The runtime stage contains only Python, the resulting virtual environment, and `backend/python`; it does not contain `uv`, test dependencies, repository history, or frontend and Node files. The service runs as the unprivileged numeric user `10001` and exposes port `8001`.

The dependency layer copies only `pyproject.toml` and `uv.lock` before running `uv sync`. Source-only changes therefore reuse the dependency layer. Dependency changes invalidate that layer intentionally. `.dockerignore` keeps local environments, build output, tests, documentation, and package caches out of the build context.

For local verification, generate the synthetic development JWT configuration described in the root README, then run:

```sh
docker compose up --build --wait gl-coding
docker inspect --format '{{.State.Health.Status}}' expense-flow-project-team-3-gl-coding-1
curl --fail http://localhost:8001/health
```

The Dockerfile health check uses Python's standard library, so no HTTP client is installed solely for health checking. ECS can use the same command and `/health` endpoint.

CI also runs the packaged-image smoke test directly. It builds the Dockerfile,
starts the image with an ephemeral synthetic JWT key pair, waits for the
container health check, requests `/health`, and verifies an authenticated
identity request through the published port:

```sh
npm run test:container:gl-coding
```

## Recording image size

Image size depends on the target architecture and base-image revision, so record the immutable image digest, platform, and size together after each release build:

```sh
docker image inspect expenseflow-gl-coding:local --format 'GL-coding {{.Id}} {{.Architecture}} {{.Size}} bytes'
docker history expenseflow-gl-coding:local
```

The reported byte count is the local uncompressed size. Registry and ECS transfer sizes are compressed and can differ. Comparing `docker history` between releases identifies unexpected layer growth while preserving an architecture-aware measurement instead of a stale hard-coded number.
