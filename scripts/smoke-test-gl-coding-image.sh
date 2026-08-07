#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="expenseflow-gl-coding-smoke-$$"
image_name="expenseflow-gl-coding:smoke"
smoke_dir="$(mktemp -d)"

cleanup() {
    if docker container inspect "${container_name}" >/dev/null 2>&1; then
        docker container rm --force "${container_name}" >/dev/null
    fi
    if [[ -n "${smoke_dir}" && -d "${smoke_dir}" ]]; then
        rm -rf -- "${smoke_dir}"
    fi
}
trap cleanup EXIT

if [[ $# -gt 0 ]]; then
    env_file="$1"
else
    env_file="${smoke_dir}/synthetic.env"
    AUTH_JWT_KEY_ID=smoke-key "${root_dir}/scripts/generate-dev-jwt-keys.sh" "${env_file}" >/dev/null
fi

if [[ ! -f "${env_file}" ]]; then
    echo "Synthetic environment file not found: ${env_file}" >&2
    exit 1
fi

jwks_json="$(sed -n 's/^AUTH_JWT_JWKS_JSON=//p' "${env_file}")"
private_key_base64="$(sed -n 's/^AUTH_JWT_PRIVATE_KEY_BASE64=//p' "${env_file}")"
if [[ -z "${jwks_json}" || -z "${private_key_base64}" ]]; then
    echo "Synthetic JWT JWKS and private key are required for the smoke test." >&2
    exit 1
fi
jwt_key_id="$(JWKS_JSON="${jwks_json}" node --input-type=module -e 'const jwks = JSON.parse(process.env.JWKS_JSON ?? ""); const kid = jwks.keys?.[0]?.kid; if (typeof kid !== "string" || kid.trim() === "") process.exit(1); process.stdout.write(kid);')"

private_key_file="${smoke_dir}/private-key.pem"
printf '%s' "${private_key_base64}" | openssl base64 -d -A > "${private_key_file}"

base64url() {
    openssl base64 -A | tr '+/' '-_' | tr -d '='
}

issued_at="$(date +%s)"
expires_at="$((issued_at + 300))"
token_header="$(printf '{"alg":"RS256","kid":"%s","typ":"JWT"}' "${jwt_key_id}" | base64url)"
token_payload="$(
    printf '%s' \
        "{\"exp\":${expires_at},\"iat\":${issued_at},\"iss\":\"expenseflow-core-case-service\",\"roles\":[\"Employee\"],\"sub\":\"22222222-2222-4222-8222-222222222222\",\"tenant_id\":\"11111111-1111-4111-8111-111111111111\",\"token_use\":\"access\"}" \
        | base64url
)"
signing_input="${token_header}.${token_payload}"
token_signature="$(
    printf '%s' "${signing_input}" \
        | openssl dgst -sha256 -sign "${private_key_file}" \
        | base64url
)"
access_token="${signing_input}.${token_signature}"

docker build \
    --file "${root_dir}/backend/python/Dockerfile" \
    --tag "${image_name}" \
    "${root_dir}"

docker run \
    --detach \
    --name "${container_name}" \
    --env "AUTH_JWT_JWKS_JSON=${jwks_json}" \
    --health-interval 1s \
    --health-retries 5 \
    --health-start-period 1s \
    --health-timeout 3s \
    --publish 127.0.0.1::8001 \
    "${image_name}" >/dev/null

health_status="starting"
for _ in {1..45}; do
    health_status="$(
        docker container inspect \
            --format '{{.State.Health.Status}}' \
            "${container_name}" 2>/dev/null || true
    )"
    if [[ "${health_status}" == "healthy" ]]; then
        break
    fi
    if [[ "${health_status}" == "unhealthy" ]]; then
        docker container logs "${container_name}" >&2
        exit 1
    fi
    sleep 1
done

if [[ "${health_status}" != "healthy" ]]; then
    docker container logs "${container_name}" >&2
    echo "GL-coding container did not become healthy." >&2
    exit 1
fi

published_address="$(docker port "${container_name}" 8001/tcp)"
health_response="$(curl --fail --silent --show-error "http://${published_address}/health")"
if [[ "${health_response}" != *'"status":"healthy"'* ]]; then
    echo "Unexpected GL-coding health response: ${health_response}" >&2
    exit 1
fi

identity_response="$(
    curl --fail --silent --show-error \
        --header "Authorization: Bearer ${access_token}" \
        "http://${published_address}/auth/me"
)"
if [[ "${identity_response}" != *'"tenant_id":"11111111-1111-4111-8111-111111111111"'* ]]; then
    echo "Authenticated GL-coding identity check returned an unexpected response." >&2
    exit 1
fi

echo "GL-coding packaged-image smoke test passed."
