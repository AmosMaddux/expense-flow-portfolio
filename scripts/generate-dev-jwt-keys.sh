#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${root_dir}/.env"
private_key_file="$(mktemp)"
public_key_file="$(mktemp)"

cleanup() {
    rm -f "${private_key_file}" "${public_key_file}"
}
trap cleanup EXIT

if [[ ! -f "${env_file}" ]]; then
    cp "${root_dir}/.env.example" "${env_file}"
fi

openssl genpkey \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:2048 \
    -out "${private_key_file}" >/dev/null 2>&1
openssl rsa \
    -in "${private_key_file}" \
    -pubout \
    -out "${public_key_file}" >/dev/null 2>&1

private_key_base64="$(base64 < "${private_key_file}" | tr -d '\n')"
public_key_base64="$(base64 < "${public_key_file}" | tr -d '\n')"

set_env_value() {
    local name="$1"
    local value="$2"
    local escaped_value

    escaped_value="${value//\\/\\\\}"
    escaped_value="${escaped_value//&/\\&}"

    if grep -q "^${name}=" "${env_file}"; then
        sed -i "s#^${name}=.*#${name}=${escaped_value}#" "${env_file}"
    else
        printf '%s=%s\n' "${name}" "${value}" >> "${env_file}"
    fi
}

set_env_value "AUTH_JWT_PRIVATE_KEY_BASE64" "${private_key_base64}"
set_env_value "AUTH_JWT_PUBLIC_KEY_BASE64" "${public_key_base64}"

echo "Generated local JWT keypair in ${env_file}."
