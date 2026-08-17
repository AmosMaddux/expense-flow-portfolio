#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_name="${CORE_CASE_IMAGE_NAME:-expenseflow-core-case:smoke}"
container_name="${CORE_CASE_SMOKE_CONTAINER_NAME:-expenseflow-core-case-smoke}"
env_file="${CORE_CASE_SMOKE_ENV_FILE:-"${root_dir}/.env"}"

cleanup() {
    docker rm --force "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ ! -f "${env_file}" ]]; then
    echo "Missing ${env_file}. Generate synthetic local JWT keys before running this smoke test." >&2
    exit 1
fi

cleanup

docker build \
    --file "${root_dir}/backend/core-case-service/Dockerfile" \
    --tag "${image_name}" \
    "${root_dir}"

docker run \
    --detach \
    --name "${container_name}" \
    --env-file "${env_file}" \
    --env PORT=3000 \
    --env AUTO_APPLY_MIGRATIONS=false \
    --env SPA_ORIGIN=https://spa.smoke.invalid \
    --publish 127.0.0.1::3000 \
    "${image_name}" >/dev/null

wait_seconds="${CORE_CASE_SMOKE_WAIT_SECONDS:-90}"
published_port="$(
    docker inspect \
        --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' \
        "${container_name}"
)"

health_status=""
for _attempt in $(seq 1 "${wait_seconds}"); do
    health_status="$(
        docker inspect \
            --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
            "${container_name}"
    )"

    if [[ "${health_status}" == "healthy" ]]; then
        break
    fi

    if [[ "${health_status}" == "exited" || "${health_status}" == "unhealthy" ]]; then
        docker logs "${container_name}" >&2 || true
        echo "Core Case image smoke container became ${health_status}." >&2
        exit 1
    fi

    sleep 1
done

if [[ "${health_status}" != "healthy" ]]; then
    docker logs "${container_name}" >&2 || true
    echo "Core Case image smoke container did not become healthy." >&2
    exit 1
fi

curl --fail --silent --show-error "http://127.0.0.1:${published_port}/health" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:${published_port}/v1/openapi.json" \
    | grep --quiet '"/v1/auth/login"'
docker exec "${container_name}" test -d /workspace/backend/core-case-service/drizzle
docker exec "${container_name}" test ! -f /workspace/.env

echo "Core Case image smoke test passed."
