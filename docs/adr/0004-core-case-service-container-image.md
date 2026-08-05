# 0004. Package the Core Case Service as an ECS-ready Node image

- Status: Accepted
- Date: 2026-08-05
- Decision makers/Desired reviewer count: Platform and Core Case reviewers

## Context

The Core Case Service is a TypeScript and Express service that owns `Expense Report` case workflow and hosts the MVP Identity/Auth routes. It needs a reproducible container image that can run locally and later on ECS Fargate behind an ALB.

The image must be small enough for routine deployment, must not bake secrets or environment-specific values into image layers, and must still contain the versioned runtime artifacts needed by the service. Runtime configuration, including database URLs, JWT key material, MFA secret protection keys, AWS endpoints, and service URLs, must come from environment variables or the deployment platform.

The service uses npm workspaces and has native runtime dependencies, including password hashing support. It also has Drizzle migration files that describe the PostgreSQL schema expected by a given service version.

## Decision

ExpenseFlow will package the Node Core Case Service with a service-local multi-stage Dockerfile at `backend/core-case-service/Dockerfile`, built from the repository root so npm workspace dependencies and the root lockfile resolve consistently.

The Dockerfile will use `node:24-bookworm-slim` for build and runtime stages. This image matches the repository's Node 24 requirement, keeps the runtime smaller than the full Debian Node image, and avoids Alpine musl compatibility risk for native packages such as `argon2`.

The runtime image will contain only production dependencies, package metadata needed for Node workspace module resolution, the compiled `dist` output, and the Core Case Service `drizzle` migration directory. It will run the compiled service directly with:

```sh
node backend/core-case-service/dist/index.js
```

The image will set safe non-secret defaults for local runtime behavior:

```sh
NODE_ENV=production
PORT=3000
AUTO_APPLY_MIGRATIONS=false
```

Normal web containers must not apply migrations at startup. Migration files are included because they are part of the versioned release artifact and allow a future one-off ECS migration task or managed release step to apply the schema version that matches the service image. Enabling migration execution remains an explicit runtime choice.

The Dockerfile will define a local/default container health check against `/health` using Node's built-in `fetch`. This avoids adding `curl`, `wget`, or extra OS packages solely for health probing. ECS task definitions may override the Dockerfile health check when the platform needs different intervals, grace periods, or load balancer behavior.

The runtime image will run as the built-in non-root `node` user. The build context will exclude `.env`, `.env.*`, `.git`, local `node_modules`, build output, coverage, and test artifacts through a root `.dockerignore`.

## Consequences

The resulting image is ECS-ready while preserving the repository's existing TypeScript build and npm workspace model. The image includes Identity/Auth because it runs the compiled full Core Case Service application rather than a partial bundle.

Using `node:24-bookworm-slim` gives a practical balance between image size and native dependency reliability. It is larger than Alpine, but it reduces the risk of native module install or runtime issues caused by libc differences.

Including migration files makes the image slightly larger, but the files are non-secret and small relative to dependencies. More importantly, it keeps application code and schema migrations tied to the same deployable artifact. This supports a future release flow where CI/CD builds and scans an image, then a deliberate migration task uses that exact image before the ECS web service rolls forward.

Keeping `AUTO_APPLY_MIGRATIONS=false` by default avoids accidental schema changes from every web task during ECS scaling or deployment. The trade-off is that production deployments will need an explicit migration step before relying on schema changes.

Using a Node-based health check keeps the runtime image smaller and avoids extra package maintenance. The health check depends on Node's built-in `fetch`, which is available in the chosen Node 24 runtime.

## Alternatives Considered

### Use `node:24-alpine`

Alpine would produce a smaller base image. It was rejected because this service uses native dependencies, and Alpine's musl libc can introduce install or runtime compatibility issues. Debian slim is the safer default for this service.

### Use the full `node:24-bookworm` image

The full Debian image would maximize compatibility, but it includes more operating system packages than the service needs at runtime. `node:24-bookworm-slim` provides the required Node version and Debian compatibility with less image weight.

### Exclude migration files from the image

Excluding `drizzle` would make the runtime image slightly smaller and force migrations to be handled entirely outside the app artifact. This was rejected because it would make future one-off ECS migration tasks harder and split the code version from its schema migration history.

### Run migrations from every web container

Running migrations automatically from normal app startup would be simple for local development, but it is risky for ECS deployments where multiple tasks can start at the same time. A failed or locking migration could prevent web containers from becoming healthy. ExpenseFlow will keep migration execution opt-in and prefer a one-off release task later.

### Use `curl` or `wget` for health checks

Installing HTTP client tools would make the health command familiar, but it would add packages solely for probing a route. Node 24 already provides `fetch`, so the health check can stay self-contained.
