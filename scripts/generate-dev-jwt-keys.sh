#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-"${root_dir}/.env"}"
private_key_file="$(mktemp)"
public_key_file="$(mktemp)"

cleanup() {
    rm -f "${private_key_file}" "${public_key_file}"
}
trap cleanup EXIT

resolve_output_path() {
    local path="$1"
    local parent_dir

    parent_dir="$(cd -P "$(dirname "${path}")" && pwd)"
    printf '%s/%s\n' "${parent_dir}" "$(basename "${path}")"
}

mkdir -p "$(dirname "${env_file}")"
env_file="$(resolve_output_path "${env_file}")"
temp_dir="$(resolve_output_path "${TMPDIR:-/tmp}/.")"
temp_dir="${temp_dir%/.}"

if [[ -L "${env_file}" ]]; then
    echo "Refusing to write generated JWT keys through a symbolic link." >&2
    exit 1
fi

if [[ "${env_file}" != "${root_dir}/.env" && "${env_file}" != "${temp_dir}"/* ]]; then
    echo "Refusing to write generated JWT keys outside ${root_dir}/.env or ${temp_dir}." >&2
    exit 1
fi

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
        sed -i.bak "s#^${name}=.*#${name}=${escaped_value}#" "${env_file}"
        rm -f "${env_file}.bak"
    else
        printf '%s=%s\n' "${name}" "${value}" >> "${env_file}"
    fi
}

set_env_value "AUTH_JWT_PRIVATE_KEY_BASE64" "${private_key_base64}"
set_env_value "AUTH_JWT_PUBLIC_KEY_BASE64" "${public_key_base64}"

echo "Generated local JWT keypair in ${env_file}."
