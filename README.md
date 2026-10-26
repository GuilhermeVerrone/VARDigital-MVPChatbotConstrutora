# MVP — Chatbot de pré-atendimento e simulação de financiamento (construtora)

Produto: [`spec.md`](spec.md). Método e decisões: [`docs/`](docs/) (prompt guide, discovery, impactos, plano). Relatórios por fase: [`docs/fases/`](docs/fases/).

## Estrutura

| Caminho | O quê |
|---|---|
| `apps/bot` | Servidor Fastify: webhook do WA-AKG (HMAC), health checks. Orquestrador entra nas próximas fases. |
| `packages/channel` | Camada de canal (hoje: verificação da assinatura do WA-AKG). `ChannelAdapter` na Fase 3. |
| `infra/` | `docker compose` (WA-AKG isolado + Postgres + Ollama + bot), scripts de setup e verificação. Ver [`infra/README.md`](infra/README.md). |
| `prompts/` | Prompts versionados do LLM (Fase 4). |
| `vendor/wa-akg` | Clone do WA-AKG em versão fixa (não versionado, não alterado). |

## Desenvolvimento

Requisitos: Node ≥ 22 (`.nvmrc`: 24), pnpm 10, Docker, Ollama.

```bash
pnpm install
pnpm check        # lint + typecheck + testes
pnpm build        # bundle do bot (apps/bot/dist/main.cjs)
```

Ambiente completo: ver [`infra/README.md`](infra/README.md).
