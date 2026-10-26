#!/usr/bin/env bash
# Verifica os critérios de aceite da Fase 0 com a stack no ar.
# Uso: ./infra/scripts/verify-phase0.sh   (depois de `docker compose up -d --build` em infra/)
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
cd "${INFRA}"
set -a; source .env; set +a
FAIL=0
step() { printf '\n### %s\n' "$*"; }
check() { if "$@"; then echo "PASS"; else echo "FAIL"; FAIL=1; fi; }

step "1. Serviços do compose"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
running() {
  local expected=(wa-akg-db wa-akg bot-db bot)
  [[ ",${COMPOSE_PROFILES:-}," == *",ollama,"* ]] && expected+=(ollama)
  local svc
  for svc in "${expected[@]}"; do
    docker compose ps --status running --services | grep -qx "${svc}" || { echo "não está rodando: ${svc}"; return 1; }
  done
}
check running

step "2. Bot: /health/deps (Postgres + Ollama) via HTTPS"
deps() { curl -sSf --cacert certs/dev-ca.crt "https://localhost:${BOT_PORT:-3100}/health/deps" | jq -c .; }
check deps

step "3. Bot recusa assinatura inválida (direto, sem WA-AKG)"
reject() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --cacert certs/dev-ca.crt -X POST \
    "https://localhost:${BOT_PORT:-3100}/webhooks/wa-akg" -H 'Content-Type: application/json' \
    -H "X-Webhook-Signature: sha256=$(printf '0%.0s' {1..64})" -d '{"event":"test","sessionId":"x","timestamp":"t","data":{}}')"
  echo "HTTP ${code}"; [ "${code}" = "401" ]
}
check reject

step "4. WA-AKG → POST /api/webhooks/{session}/{id}/test → bot valida HMAC"
check "${INFRA}/scripts/wa-akg-bootstrap.sh"

step "5. Ollama responde"
OLLAMA_URL="http://localhost:11434"
[[ ",${COMPOSE_PROFILES:-}," == *",ollama,"* ]] && OLLAMA_URL="http://localhost:${OLLAMA_PORT:-11435}"
check "${INFRA}/scripts/check-ollama.sh" "${OLLAMA_URL}"

echo
if [ "${FAIL}" = 0 ]; then echo "FASE 0: todos os checks automáticos PASSARAM"; else echo "FASE 0: há checks FALHANDO"; exit 1; fi
