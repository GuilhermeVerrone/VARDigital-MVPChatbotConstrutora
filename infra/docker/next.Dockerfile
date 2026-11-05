# Imagem de um app Next (site ou painel). Contexto de build: raiz do monorepo.
#   docker build -f infra/docker/next.Dockerfile --build-arg APP=site -t mvp-construtora/site .
ARG APP=site

FROM node:24-alpine AS build
ARG APP
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/site/package.json apps/site/
COPY apps/painel/package.json apps/painel/
COPY apps/bot/package.json apps/bot/
COPY packages/channel/package.json packages/channel/
COPY packages/conversation/package.json packages/conversation/
COPY packages/crm/package.json packages/crm/
COPY packages/llm/package.json packages/llm/
COPY packages/parsers/package.json packages/parsers/
COPY packages/presentation/package.json packages/presentation/
COPY packages/db/package.json packages/db/
COPY packages/simulation/package.json packages/simulation/
COPY packages/ui/package.json packages/ui/
# Sem scripts: o postinstall do @mvp/db (prisma generate) precisa do schema, que ainda não foi copiado.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY prompts prompts
COPY apps/${APP} apps/${APP}
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p apps/${APP}/public && pnpm --filter @mvp/db generate && pnpm --filter @mvp/${APP} build
# O standalone não leva public/ nem .next/static: o runtime os copia abaixo.

FROM node:24-alpine
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build /repo/apps/${APP}/public ./apps/${APP}/public
RUN printf '#!/bin/sh\nexec node apps/%s/server.js\n' "${APP}" > /app/start.sh && chmod +x /app/start.sh
USER node
EXPOSE 3000
CMD ["/app/start.sh"]
