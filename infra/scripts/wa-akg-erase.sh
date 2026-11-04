#!/usr/bin/env bash
# Limpa no WA-AKG o histórico dos titulares que pediram a exclusão dos dados (LGPD, Fase 7).
#
# O WA-AKG guarda as mensagens no MySQL dele e não tem endpoint para apagá-las, então o bot, ao
# apagar um lead, deixa uma pendência em `erasure_tasks` (banco do bot) com o endereço do chat.
# Este script lê as pendências, apaga mensagens, contato e etiquetas desse endereço no MySQL do
# WA-AKG e marca a pendência como feita (o endereço some da tabela).
#
# Uso (a partir de infra/):
#   ./scripts/wa-akg-erase.sh --dry-run   # só lista quantas pendências existem
#   ./scripts/wa-akg-erase.sh             # executa
# Rode depois de qualquer pedido de exclusão (ou agende, por exemplo, de hora em hora).
# Limitações: não apaga arquivos de mídia no volume do WA-AKG nem o que já está no aparelho do
# número do piloto; confira os dois manualmente. NÃO foi exercitado contra um WA-AKG real
# (ver docs/fases/fase-7.md, "Não verificado").
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "${INFRA}/.env" ] || { echo "falta infra/.env (rode scripts/init-env.sh)"; exit 1; }
set -a; source "${INFRA}/.env"; set +a
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

compose() { docker compose --project-directory "${INFRA}" "$@"; }
bot_sql() { compose exec -T bot-db psql -U bot -d bot -v ON_ERROR_STOP=1 -At -F '|' "$@"; }
wa_sql() { compose exec -T -e MYSQL_PWD="${WA_AKG_MYSQL_ROOT_PASSWORD:?}" wa-akg-db mysql -uroot --batch wa_akg; }

pending="$(bot_sql -c "select id, chat_id from erasure_tasks where done_at is null and chat_id is not null order by requested_at")"
if [ -z "${pending}" ]; then echo "nenhuma limpeza pendente"; exit 0; fi
echo "$(printf '%s\n' "${pending}" | wc -l | tr -d ' ') limpeza(s) pendente(s)"
[ "${DRY}" = 1 ] && exit 0

printf '%s\n' "${pending}" | while IFS='|' read -r id jid; do
  # O endereço vai para dentro de SQL: só aceita o formato de JID (dígitos@domínio), nada mais.
  if ! [[ "${jid}" =~ ^[0-9]+@(s\.whatsapp\.net|lid)$ ]]; then
    echo "ignorando ${id}: endereço fora do formato esperado" >&2; continue
  fi
  # Todos os endereços do mesmo contato (telefone e LID), lidos antes de apagar.
  known="$(wa_sql <<SQL | tail -n +2
SELECT jid FROM Contact WHERE jid = '${jid}' OR lid = '${jid}' OR remoteJidAlt = '${jid}'
UNION SELECT lid FROM Contact WHERE (jid = '${jid}' OR lid = '${jid}' OR remoteJidAlt = '${jid}') AND lid IS NOT NULL
UNION SELECT remoteJidAlt FROM Contact WHERE (jid = '${jid}' OR lid = '${jid}' OR remoteJidAlt = '${jid}') AND remoteJidAlt IS NOT NULL;
SQL
)"
  list="'${jid}'"
  while IFS= read -r other; do
    [ -z "${other}" ] && continue
    [[ "${other}" =~ ^[0-9]+@(s\.whatsapp\.net|lid)$ ]] || { echo "ignorando endereço fora do formato em ${id}" >&2; continue; }
    list="${list},'${other}'"
  done <<< "${known}"
  wa_sql <<SQL
START TRANSACTION;
DELETE FROM Message WHERE remoteJid IN (${list}) OR senderJid IN (${list});
DELETE FROM ChatLabel WHERE chatJid IN (${list});
DELETE FROM ScheduledMessage WHERE jid IN (${list});
DELETE FROM Contact WHERE jid IN (${list}) OR lid IN (${list}) OR remoteJidAlt IN (${list});
COMMIT;
SQL
  bot_sql -c "update erasure_tasks set done_at = now(), chat_id = null where id = '${id}'" >/dev/null
  echo "limpeza ${id} concluída"
done
