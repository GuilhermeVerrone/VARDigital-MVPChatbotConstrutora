// Configuração da CLI do Prisma (migrate/generate). A URL vem de BOT_DATABASE_URL, a mesma
// variável do bot; nunca de arquivo versionado.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.BOT_DATABASE_URL ?? '' },
});
