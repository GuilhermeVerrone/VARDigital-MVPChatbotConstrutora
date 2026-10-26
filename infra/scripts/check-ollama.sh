#!/usr/bin/env bash
# Verifica se o Ollama responde: lista modelos e gera uma resposta JSON curta em PT-BR.
# Uso: ./scripts/check-ollama.sh [url] [modelo]
#   macOS (Ollama no host):        ./scripts/check-ollama.sh http://localhost:11434
#   Linux (profile "ollama"):      ./scripts/check-ollama.sh http://localhost:11435
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "${INFRA}/.env" ] && { set -a; source "${INFRA}/.env"; set +a; }

URL="${1:-http://localhost:11434}"
MODEL="${2:-${OLLAMA_SMOKE_MODEL:-llama3.2:3b}}"

echo "== ${URL}/api/version"
curl -sSf "${URL}/api/version"; echo

echo "== modelos"
curl -sSf "${URL}/api/tags" | jq -r '.models[].name'

if ! curl -sSf "${URL}/api/tags" | jq -e --arg m "${MODEL}" '.models[] | select(.name==$m)' >/dev/null; then
  echo "Modelo ${MODEL} ausente. Baixe com: ollama pull ${MODEL}  (container: docker compose exec ollama ollama pull ${MODEL})"
  exit 1
fi

echo "== geração (${MODEL}, format=json)"
BODY="$(jq -nc --arg m "${MODEL}" '{
  model: $m, stream: false, format: "json", options: {temperature: 0},
  prompt: "Extraia a renda mensal da frase do cliente e responda só JSON {\"renda\": número}. Frase: \"ganho uns 5 mil por mês\""
}')"
START=$(date +%s)
RES="$(curl -sSf "${URL}/api/generate" -d "${BODY}")"
END=$(date +%s)
echo "${RES}" | jq '{response, total_s: (.total_duration/1e9), load_s: (.load_duration/1e9), eval_count}'
echo "parede: $((END-START)) s"
echo "${RES}" | jq -e '.response | fromjson | type == "object"' >/dev/null && echo "OK: Ollama respondeu JSON válido"
