#!/usr/bin/env bash
# Cria infra/.env a partir de infra/.env.example com segredos aleatórios. Não sobrescreve.
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${INFRA}/.env"

if [ -f "${ENV_FILE}" ]; then
  echo "${ENV_FILE} já existe; nada a fazer."
  exit 0
fi

rand() { openssl rand -hex "${1:-24}"; }
cp "${INFRA}/.env.example" "${ENV_FILE}"

set_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="${key}" -v v="${value}" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "${ENV_FILE}" > "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

set_var WA_AKG_MYSQL_ROOT_PASSWORD "$(rand)"
set_var WA_AKG_AUTH_SECRET "$(rand 32)"
set_var CHAT_HASH_SECRET "$(rand 32)"
set_var WA_AKG_SWAGGER_PASSWORD "$(rand 12)"
set_var WA_AKG_ADMIN_PASSWORD "$(rand 12)"
set_var BOT_DB_PASSWORD "$(rand)"
set_var WA_AKG_WEBHOOK_SECRET "$(rand 32)"

if [ "$(uname -s)" = "Linux" ]; then
  set_var COMPOSE_PROFILES "ollama"
  set_var OLLAMA_BASE_URL "http://ollama:11434"
fi

chmod 600 "${ENV_FILE}"
echo "Criado ${ENV_FILE} (segredos aleatórios; não versionar)."
