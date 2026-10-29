// URL do banco para os scripts: BOT_DATABASE_URL (a mesma do bot). Nunca versionada.
export function databaseUrl(): string {
  const url = process.env.BOT_DATABASE_URL;
  if (!url) {
    console.error('defina BOT_DATABASE_URL (ex.: postgresql://bot:<senha>@127.0.0.1:5433/bot; ver infra/README.md)');
    process.exit(2);
  }
  return url;
}
