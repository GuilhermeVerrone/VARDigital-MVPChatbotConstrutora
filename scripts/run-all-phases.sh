#!/usr/bin/env bash
# Executa as fases do docs/04-plano.md em sequência.
# Cada fase = um processo `claude` novo (contexto limpo), modelo Opus, sem pedidos de permissão.
# Uso: ./scripts/run-all-phases.sh [fase_inicial=0] [fase_final=8]
set -uo pipefail

cd "$(dirname "$0")/.."
START="${1:-0}"
END="${2:-8}"
MODEL="${CLAUDE_MODEL:-opus}"
mkdir -p docs/fases logs

for N in $(seq "$START" "$END"); do
  REPORT="docs/fases/fase-${N}.md"
  LOG="logs/fase-${N}.log"
  echo "=== Fase ${N} (modelo: ${MODEL}) — log: ${LOG} ==="

  PROMPT="Você executa a **Fase ${N}** do projeto em $(pwd). Você começa sem contexto prévio.

LEIA PRIMEIRO: docs/01-prompt-guide.md, docs/02-discovery.md, docs/03-impactos.md, docs/04-plano.md (regras gerais e a seção da Fase ${N}), spec.md conforme necessário, e os relatórios das fases anteriores em docs/fases/ (são seu único histórico).

MODO: autônomo total. Não faça perguntas. Decisões: use as recomendações dos docs e registre-as no relatório. A cada implementação concluída, faça um git commit curto, em inglês (ex.: 'add webhook handler'), SEM co-autoria: não inclua trailer Co-Authored-By nem qualquer atribuição ao Claude. Nunca faça push. Não coloque segredos no repositório. Não altere o código do WA-AKG.
Pré-requisito: se alguma fase anterior tiver STATUS: FALHA no relatório, corrija-a antes de começar a sua.
Limites reais (Docker/Ollama/QR code do WhatsApp indisponíveis): não trave; faça tudo que for verificável, documente o que não pôde ser verificado e como o usuário valida.
Escopo e critérios de aceite: exatamente os da Fase ${N} em docs/04-plano.md. Rode os testes de verdade e cole a saída real no relatório.
AO FINAL escreva ${REPORT} com a PRIMEIRA linha exatamente 'STATUS: PASS' ou 'STATUS: PARCIAL' ou 'STATUS: FALHA', seguida de: o que foi feito, arquivos principais, decisões, resultados dos testes, o que ficou não verificado e riscos. Seja fiel ao resultado."

  claude -p "$PROMPT" \
    --model "$MODEL" \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1 | tee "$LOG"

  if [ ! -f "$REPORT" ]; then
    echo "!! Fase ${N} não gerou ${REPORT}. Abortando."; exit 1
  fi
  STATUS="$(head -n1 "$REPORT")"
  echo ">> Fase ${N}: ${STATUS}"
  if [ "$STATUS" = "STATUS: FALHA" ]; then
    echo "!! Fase ${N} falhou. Corrija e rode: ./scripts/run-all-phases.sh ${N}"; exit 1
  fi
done

echo "=== Todas as fases de ${START} a ${END} concluídas ==="
