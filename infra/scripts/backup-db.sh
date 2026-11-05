#!/usr/bin/env bash
# Backup do Postgres do bot (leads, conversas, condições, usuários do painel, auditoria). Fase 16.
#
#   ./scripts/backup-db.sh [--dir ./backups] [--keep 14] [--encrypt-to <chave-age>] [--service bot-db]
#
# Gera <dir>/bot-AAAAMMDD-HHMMSS.dump (pg_dump -Fc, comprimido). O dump contém DADOS PESSOAIS:
#   - com --encrypt-to (chave pública do `age`) o arquivo sai como .dump.age e o claro é apagado;
#   - sem a opção, o arquivo fica com permissão 600 e o script avisa.
# Mantém só os --keep mais recentes (padrão 14). Rode todo dia pelo cron do host, por exemplo:
#   15 3 * * * cd /opt/mvp/infra && ./scripts/backup-db.sh --encrypt-to age1... >> backups/backup.log 2>&1
# Cópia fora da máquina (rsync, rclone, bucket) fica por conta de quem opera: o backup no mesmo disco
# não protege contra perda da VPS.
set -euo pipefail

DIR="./backups"
KEEP=14
RECIPIENT=""
SERVICE="bot-db"
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --encrypt-to) RECIPIENT="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
case "${KEEP}" in ''|*[!0-9]*) echo "--keep precisa ser um número" >&2; exit 2 ;; esac
[ "${KEEP}" -ge 1 ] || { echo "--keep precisa ser >= 1" >&2; exit 2; }

mkdir -p "${DIR}"
chmod 700 "${DIR}"
umask 077
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DIR}/bot-${STAMP}.dump"

# O pg_dump roda dentro do container (a versão do cliente é a do servidor); a senha vem do ambiente dele.
docker compose exec -T "${SERVICE}" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "${OUT}.partial"

# Dump vazio ou truncado não pode virar "backup bom": confere se o pg_restore consegue listar o conteúdo.
if ! docker compose exec -T "${SERVICE}" pg_restore -l < "${OUT}.partial" > /dev/null 2>&1; then
  rm -f "${OUT}.partial"
  echo "backup inválido (pg_restore não leu o arquivo); nada foi guardado" >&2
  exit 1
fi
mv "${OUT}.partial" "${OUT}"

if [ -n "${RECIPIENT}" ]; then
  command -v age >/dev/null || { echo "age não instalado (apt install age)" >&2; rm -f "${OUT}"; exit 1; }
  age -r "${RECIPIENT}" -o "${OUT}.age" "${OUT}"
  rm -f "${OUT}"
  OUT="${OUT}.age"
else
  echo "AVISO: backup sem cifra (contém dados pessoais). Use --encrypt-to <chave-age> e guarde fora da VPS." >&2
fi

# Retenção: apaga os mais antigos além de --keep.
# shellcheck disable=SC2012
ls -1t "${DIR}"/bot-*.dump "${DIR}"/bot-*.dump.age 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "${old}"; done

echo "backup ok: ${OUT} ($(wc -c < "${OUT}" | tr -d ' ') bytes)"
