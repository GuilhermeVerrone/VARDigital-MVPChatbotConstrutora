# Contexto de build: raiz do monorepo (ver infra/docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY packages/channel/package.json packages/channel/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/bot apps/bot
RUN pnpm --filter @mvp/bot build

# Runtime: só o bundle (sem node_modules).
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/bot/dist ./dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD node -e "const p=process.env.BOT_TLS_CERT_FILE?'https':'http';require(p).get({host:'127.0.0.1',port:process.env.BOT_PORT||3100,path:'/health',rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.cjs"]
