#!/usr/bin/env bash
# Restaura um backup do Postgres do bot (gerado por backup-db.sh). DESTRUTIVO: substitui o conteúdo do banco.
#
#   ./scripts/restore-db.sh <arquivo.dump | arquivo.dump.age> --yes [--identity <chave-privada-age>] [--service bot-db]
#
# Pare os apps antes (docker compose stop bot painel site) e suba de novo depois. Ensaie a restauração
# num banco descartável antes de precisar dela de verdade (ver o runbook).
set -euo pipefail

FILE="${1:-}"
[ -n "${FILE}" ] && [ -f "${FILE}" ] || { echo "uso: restore-db.sh <arquivo> --yes [--identity chave.txt]" >&2; exit 2; }
shift
YES=0
IDENTITY=""
SERVICE="bot-db"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
[ "${YES}" = "1" ] || { echo "isto SUBSTITUI o banco; confirme com --yes" >&2; exit 2; }

read_dump() {
  case "${FILE}" in
    *.age)
      [ -n "${IDENTITY}" ] || { echo "arquivo cifrado: informe --identity <chave-privada-age>" >&2; exit 2; }
      age -d -i "${IDENTITY}" "${FILE}" ;;
    *) cat "${FILE}" ;;
  esac
}

read_dump | docker compose exec -T "${SERVICE}" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error'
echo "restauração concluída a partir de ${FILE}"
