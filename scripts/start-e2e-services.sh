#!/bin/sh

set -eu

required_services="postgres redis gl-coding dynamodb minio localstack"
init_services="dynamodb-init minio-init postgres-e2e-marker"
log_services="$required_services $init_services"

print_dependency_logs() {
    status=$?

    if [ "$status" -eq 0 ]; then
        return
    fi

    printf '\nE2E dependency startup failed. Docker Compose service status:\n' >&2
    docker compose ps $log_services >&2 || true

    printf '\nRecent E2E dependency logs:\n' >&2
    docker compose logs --tail=200 $log_services >&2 || true

    exit "$status"
}

trap print_dependency_logs EXIT

docker compose up -d --wait $required_services
docker compose run --rm dynamodb-init
docker compose run --rm minio-init
docker compose run --rm postgres-e2e-marker
