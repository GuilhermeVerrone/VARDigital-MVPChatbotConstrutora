#!/usr/bin/env bash
# Prepara o WA-AKG para o bot e testa o webhook ponta a ponta:
#   1. login do admin (NextAuth) → gera/obtém API key (salva em infra/.env)
#   2. cria a sessão WhatsApp (sem QR ela fica desconectada, mas já existe)
#   3. cria o webhook apontando para o bot, com secret HMAC
#   4. dispara POST /api/webhooks/{session}/{id}/test e mostra o resultado
# Idempotente. Requer: curl, jq, stack no ar (docker compose up -d).
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${INFRA}/.env"
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a

BASE="http://localhost:${WA_AKG_PORT:-3000}"
SESSION="${WA_AKG_SESSION_ID:-piloto}"
WEBHOOK_URL="${BOT_WEBHOOK_URL:-https://bot:3100/webhooks/wa-akg}"
JAR="$(mktemp)"; trap 'rm -f "${JAR}"' EXIT

say() { printf '\n== %s\n' "$*"; }
api() { # api METHOD PATH [JSON]
  curl -sS -X "$1" "${BASE}/api$2" -H "X-API-Key: ${WA_AKG_API_KEY}" -H 'Content-Type: application/json' ${3:+-d "$3"}
}

say "Aguardando WA-AKG em ${BASE}"
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "${BASE}/api/auth/csrf" && break
  sleep 2
done

if [ -z "${WA_AKG_API_KEY:-}" ] || [ "$(api GET /sessions | jq -r '.status // false')" != "true" ]; then
  say "Login do admin e geração da API key"
  CSRF="$(curl -sS -c "${JAR}" -b "${JAR}" "${BASE}/api/auth/csrf" | jq -r .csrfToken)"
  curl -sS -o /dev/null -c "${JAR}" -b "${JAR}" -X POST "${BASE}/api/auth/callback/credentials" \
    --data-urlencode "email=${WA_AKG_ADMIN_EMAIL}" --data-urlencode "password=${WA_AKG_ADMIN_PASSWORD}" \
    --data-urlencode "csrfToken=${CSRF}" --data-urlencode "callbackUrl=${BASE}/dashboard"
  KEY="$(curl -sS -c "${JAR}" -b "${JAR}" -X POST "${BASE}/api/user/api-key" | jq -r '.data.apiKey // empty')"
  [ -n "${KEY}" ] || { echo "Falha ao gerar API key (login falhou?)"; exit 1; }
  tmp="$(mktemp)"
  awk -v v="${KEY}" 'BEGIN{FS=OFS="="} $1=="WA_AKG_API_KEY"{$0="WA_AKG_API_KEY="v} {print}' "${ENV_FILE}" > "${tmp}" && mv "${tmp}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  WA_AKG_API_KEY="${KEY}"
  echo "API key gerada e salva em infra/.env (WA_AKG_API_KEY)"
fi

say "Sessão '${SESSION}'"
if api GET /sessions | jq -e --arg s "${SESSION}" '.data[]? | select(.sessionId==$s)' >/dev/null; then
  echo "já existe"
else
  api POST /sessions "$(jq -nc --arg s "${SESSION}" '{name:$s, sessionId:$s}')" | jq -c '{status, message}'
fi

say "Webhook → ${WEBHOOK_URL}"
WEBHOOK_ID="$(api GET "/webhooks/${SESSION}" | jq -r --arg u "${WEBHOOK_URL}" '[.data[]? | select(.url==$u)][0].id // empty')"
if [ -n "${WEBHOOK_ID}" ]; then
  echo "já existe (${WEBHOOK_ID}); atualizando secret/eventos"
  api PUT "/webhooks/${SESSION}/${WEBHOOK_ID}" \
    "$(jq -nc --arg s "${WA_AKG_WEBHOOK_SECRET}" '{secret:$s, events:["message.received","connection.update"], isActive:true}')" \
    | jq -c '{atualizado: (.id != null), isActive, events}' # PUT devolve o webhook puro (sem envelope status/data)
else
  RES="$(api POST "/webhooks/${SESSION}" "$(jq -nc --arg u "${WEBHOOK_URL}" --arg s "${WA_AKG_WEBHOOK_SECRET}" \
    '{name:"mvp-bot", url:$u, secret:$s, events:["message.received","connection.update"]}')")"
  echo "${RES}" | jq -c '{status, message, error}'
  WEBHOOK_ID="$(echo "${RES}" | jq -r '.data.id // empty')"
  [ -n "${WEBHOOK_ID}" ] || exit 1
fi

say "Teste de entrega (WA-AKG → bot, assinado com HMAC)"
RESULT="$(api POST "/webhooks/${SESSION}/${WEBHOOK_ID}/test")"
echo "${RESULT}" | jq .
if [ "$(echo "${RESULT}" | jq -r '.data.success')" = "true" ]; then
  echo "OK: o bot aceitou a assinatura (só responde 200 com HMAC válido)."
else
  echo "FALHA no teste do webhook"; exit 1
fi

say "Próximo passo manual: conectar o número de teste"
echo "Abra ${BASE}/dashboard (login ${WA_AKG_ADMIN_EMAIL}) → sessão '${SESSION}' → escaneie o QR code."
