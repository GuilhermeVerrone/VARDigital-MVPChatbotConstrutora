# Site de vendas do ConstruBot: arquivos estáticos servidos por um Caddy mínimo. Contexto: raiz do monorepo.
#   docker build -f infra/docker/vitrine.Dockerfile -t mvp-construtora/vitrine .
# Os endereços da demonstração e o contato de vendas entram no build (NEXT_PUBLIC_*): ver docs/v2/06-runbook.md.
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/vitrine/package.json apps/vitrine/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @mvp/vitrine
COPY apps/vitrine apps/vitrine
ARG NEXT_PUBLIC_DEMO_SITE_URL=""
ARG NEXT_PUBLIC_DEMO_WHATSAPP=""
ARG NEXT_PUBLIC_VENDAS_WHATSAPP=""
ARG NEXT_PUBLIC_VENDAS_EMAIL=""
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_DEMO_SITE_URL=$NEXT_PUBLIC_DEMO_SITE_URL NEXT_PUBLIC_DEMO_WHATSAPP=$NEXT_PUBLIC_DEMO_WHATSAPP \
    NEXT_PUBLIC_VENDAS_WHATSAPP=$NEXT_PUBLIC_VENDAS_WHATSAPP NEXT_PUBLIC_VENDAS_EMAIL=$NEXT_PUBLIC_VENDAS_EMAIL
RUN pnpm --filter @mvp/vitrine build

FROM caddy:2-alpine
COPY apps/vitrine/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/vitrine/out /srv
EXPOSE 80
