# MVP — Chatbot de pré-atendimento e simulação de financiamento (construtora)

Produto: [`spec.md`](spec.md). Método e decisões: [`docs/`](docs/) (prompt guide, discovery, impactos, plano). Relatórios por fase: [`docs/fases/`](docs/fases/).

## Estrutura

| Caminho | O quê |
|---|---|
| `apps/bot` | Servidor Fastify: webhook do WA-AKG (HMAC, filtro, idempotência) → fila no Postgres → worker (hoje responde com eco; o orquestrador entra na Fase 5), health checks. |
| `packages/simulation` | Motor de simulação puro (SAC/Price, enquadramento, FGTS, subsídio, idade, parecer, fluxo de obra). Ver [`packages/simulation/README.md`](packages/simulation/README.md). |
| `packages/db` | Banco do bot (Prisma/PostgreSQL): schema do spec §10, migrations, seed ILUSTRATIVO, parâmetros financeiros com vigência + CLI com auditoria, simulação gravada com a versão dos parâmetros. Ver [`packages/db/README.md`](packages/db/README.md). |
| `packages/channel` | Camada de canal: `ChannelAdapter`, `WaAkgAdapter` (texto, lista, PDF, presença, leitura), parser/filtro do webhook e verificação da assinatura HMAC. |
| `infra/` | `docker compose` (WA-AKG isolado + Postgres + Ollama + bot), scripts de setup e verificação. Ver [`infra/README.md`](infra/README.md). |
| `prompts/` | Prompts versionados do LLM (Fase 4). |
| `vendor/wa-akg` | Clone do WA-AKG em versão fixa (não versionado, não alterado). |

## Desenvolvimento

Requisitos: Node ≥ 22 (`.nvmrc`: 24), pnpm 10, Docker, Ollama. Os testes de `packages/db` precisam de PostgreSQL: `initdb`/`pg_ctl` no PATH ou `TEST_DATABASE_URL` (ver [`packages/db/README.md`](packages/db/README.md#testes)).

```bash
pnpm install
pnpm check        # lint + typecheck + testes
pnpm build        # bundle do bot (apps/bot/dist/main.mjs)
```

Ambiente completo: ver [`infra/README.md`](infra/README.md).
