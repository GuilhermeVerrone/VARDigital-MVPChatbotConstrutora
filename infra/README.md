# infra — ambiente local

Sobe, isolados, o WA-AKG (gateway WhatsApp **não oficial**, só para MVP/piloto) com seu MySQL, e o nosso lado: Postgres próprio, bot (Fastify) e Ollama.

```
             rede wa-akg-internal                rede edge (198.18.100.0/24)              rede bot-internal
 wa-akg-db (MySQL) ── wa-akg (:3000) ──── https://bot:3100/webhooks/wa-akg ────▶ bot (:3100) ── bot-db (Postgres :5433 no host)
                                                                                         └──── Ollama (host no macOS / container no Linux)
```

## Primeira vez

```bash
cd infra
./scripts/init-env.sh        # cria infra/.env com segredos aleatórios (não versionado)
./scripts/gen-dev-certs.sh   # CA de dev + certificado do bot (infra/certs, não versionado)
./scripts/fetch-wa-akg.sh    # clona o WA-AKG v1.7.0 (commit fixo) em vendor/wa-akg, sem alterações
docker compose up -d --build # build do WA-AKG leva ~5 min e ocupa ~1,8 GB de imagem
./scripts/wa-akg-bootstrap.sh  # admin → API key → sessão "piloto" → webhook com secret → teste
./scripts/verify-phase0.sh     # todos os critérios automáticos da Fase 0
```

### Ollama

| Ambiente | Como rodar | `infra/.env` |
|---|---|---|
| macOS (dev) | `OLLAMA_HOST=0.0.0.0:11434 ollama serve` no host (Docker no Mac não usa a GPU/Metal) e `ollama pull llama3.2:3b` | `COMPOSE_PROFILES=` e `OLLAMA_BASE_URL=http://host.docker.internal:11434` |
| Linux/servidor | container do compose | `COMPOSE_PROFILES=ollama` e `OLLAMA_BASE_URL=http://ollama:11434`; depois `docker compose exec ollama ollama pull llama3.2:3b` |

`init-env.sh` já escolhe pelo sistema operacional. A imagem `ollama/ollama` tem ~2,8 GB comprimida (arm64).
O modelo de produção será escolhido na Fase 4; `llama3.2:3b` é só para o teste de fumaça.

### Conectar o número de teste (manual)

1. Abra http://localhost:3000/dashboard e entre com `WA_AKG_ADMIN_EMAIL` / `WA_AKG_ADMIN_PASSWORD` de `infra/.env`.
2. Sessão `piloto` → escaneie o QR code com o WhatsApp do **número dedicado ao piloto** (nunca um número pessoal/comercial principal: risco de ban).
3. Para inspecionar o formato real das mensagens: em `infra/.env` defina `WEBHOOK_CAPTURE_DIR=/captures`, rode `docker compose up -d bot`, mande mensagens para o número e veja `docker compose exec bot ls /captures`. **Os arquivos contêm dados pessoais**: apague depois (`docker compose exec bot sh -c 'rm -f /captures/*'`) e desligue a captura.

## Por que HTTPS e a rede 198.18.100.0/24

O WA-AKG (src/lib/security.ts → `validateSafeUrl`) só aceita webhooks `https://` e recusa hosts que resolvam para IP privado/loopback (10/8, 172.16/12, 192.168/16, 127/8…). Como não alteramos o WA-AKG:

- o bot serve HTTPS com certificado de uma **CA de desenvolvimento**, e o container do WA-AKG confia nela via `NODE_EXTRA_CA_CERTS` (variável de ambiente, não código);
- a rede `edge` usa 198.18.0.0/15 (RFC 2544, faixa de benchmark, nunca roteada na internet), que não está na lista bloqueada.

**Isso é só para desenvolvimento.** No piloto/produção, exponha o bot num domínio público com certificado válido (reverse proxy + Let's Encrypt) e use essa URL em `BOT_WEBHOOK_URL`.

## Banco do bot (migrations, seed, parâmetros)

```bash
docker compose up -d bot-db
./scripts/db-setup.sh                 # aplica migrations, roda o seed idempotente e mostra os parâmetros vigentes
```

Alterar parâmetros financeiros (cria nova versão com vigência e auditoria): ver [`packages/db/README.md`](../packages/db/README.md#cli-de-parâmetros).

## Bot: fila, worker e eco (Fase 3)

O bot precisa do banco migrado e da API key do WA-AKG (`WA_AKG_API_KEY` em `infra/.env`, gerada pelo `wa-akg-bootstrap.sh`). Na primeira vez a ordem é:

```bash
docker compose up -d --build
./scripts/wa-akg-bootstrap.sh         # grava WA_AKG_API_KEY em infra/.env
./scripts/db-setup.sh                 # migrations (inclui a fila de entrada)
docker compose up -d bot              # recria o bot já com a API key
```

Com a sessão `piloto` conectada, qualquer mensagem de texto enviada ao número volta como `Eco: …`, com "digitando…" antes. Acompanhe:

```bash
docker compose logs -f bot
docker compose exec bot-db psql -U bot -d bot -c "select external_id, status, attempts, last_error from processed_messages order by received_at desc limit 10"
```

Estados da fila: `PENDING` (aguardando ou em espera de nova tentativa), `PROCESSING`, `DONE` (conteúdo apagado), `DEAD` (esgotou as tentativas; inspecionar `last_error`). `ALLOWED_PHONES` (obrigatória) limita quem o bot atende e para quem envia. Variáveis: `INBOX_POLL_MS`, `INBOX_LOCK_MS`, `INBOX_MAX_ATTEMPTS` (defaults no `apps/bot/src/config.ts`).

## Comandos úteis

```bash
docker compose ps
docker compose logs -f bot            # logs JSON; telefone mascarado, conteúdo não é logado
curl --cacert certs/dev-ca.crt https://localhost:3100/health/deps
docker compose down                   # para (mantém volumes)
docker compose down -v                # apaga também os dados (MySQL do WA-AKG, Postgres, sessão do WhatsApp)
```

Espaço em disco: o build do WA-AKG deixa ~2 GB de cache de build; `docker builder prune` libera (atenção: apaga o cache de build de todos os projetos).
