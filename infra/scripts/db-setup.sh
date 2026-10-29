#!/usr/bin/env bash
# Aplica as migrations do banco do bot (Postgres do compose) e roda o seed idempotente.
# Uso: ./scripts/db-setup.sh            (precisa de `docker compose up -d bot-db` antes)
# Depois: BOT_DATABASE_URL vem impresso para usar a CLI de parâmetros (pnpm --filter @mvp/db params ...).
set -euo pipefail
INFRA="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "${INFRA}/.." && pwd)"
[ -f "${INFRA}/.env" ] || { echo "falta infra/.env (rode scripts/init-env.sh)"; exit 1; }
set -a; source "${INFRA}/.env"; set +a

export BOT_DATABASE_URL="postgresql://bot:${BOT_DB_PASSWORD:?}@127.0.0.1:${BOT_DB_PORT:-5433}/bot"

echo "== migrations"
pnpm --dir "${ROOT}" --filter @mvp/db migrate:deploy
echo "== seed (ILUSTRATIVO)"
pnpm --dir "${ROOT}" --filter @mvp/db db:seed
echo "== parâmetros vigentes hoje"
pnpm --dir "${ROOT}" --silent --filter @mvp/db params show
echo
echo "Para a CLI: export BOT_DATABASE_URL='postgresql://bot:<BOT_DB_PASSWORD>@127.0.0.1:${BOT_DB_PORT:-5433}/bot'"
