# Aplica as migrations do banco do bot (prisma migrate deploy). Roda uma vez por deploy, antes dos apps.
# Contexto de build: raiz do monorepo.
FROM node:24-alpine
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
COPY packages/presentation/package.json packages/presentation/
COPY packages/simulation/package.json packages/simulation/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @mvp/db...
COPY tsconfig.base.json ./
COPY packages/db packages/db
USER root
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
