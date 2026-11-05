# infra — ambiente local

Sobe, isolados, o WA-AKG (gateway WhatsApp **não oficial**, só para MVP/piloto) com seu MySQL, e o nosso lado: Postgres próprio, bot (Fastify) e, opcionalmente, Ollama (o LLM padrão é a API da Anthropic).

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

### LLM (API da Anthropic, padrão)

O fallback dos parsers e o FAQ usam a **API da Anthropic** (modelo pequeno, `claude-haiku-5-5` por padrão; D13). Não há Ollama na stack padrão.

| Variável (`infra/.env`) | Efeito |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API. **Só aqui**: nunca no código, nos logs nem em issues. Sem ela o bot sobe e segue só com os parsers (repergunta); `GET /health/deps` mostra `llm` como degradado. |
| `LLM_PROVIDER` | `anthropic` (padrão) ou `ollama`. |
| `LLM_MODEL` | Vazio = padrão do provedor (`claude-haiku-5-5` / `qwen2.5:7b`). |
| `LLM_MAX_CALLS_PER_CONVERSATION` | Teto de chamadas por conversa (padrão 30). Depois dele, só os parsers. |
| `LLM_ENABLED=false` | Desliga o LLM de vez. |

O que sai do servidor: só o texto da resposta do lead (com e-mail, telefone, documento e o nome do lead mascarados) e a definição do campo. Campos de nome, telefone e e-mail nunca vão ao LLM. O conteúdo não é registrado nos logs. Confira os termos de retenção e de treinamento da conta da API antes de usar com lead real.

### Ollama (opcional)

Só com `LLM_PROVIDER=ollama`. Precisa de ~6 GB livres, por isso **não** cabe na VPS de 4 GB junto com o resto.

| Ambiente | Como rodar | `infra/.env` |
|---|---|---|
| macOS (dev) | `OLLAMA_HOST=0.0.0.0:11434 ollama serve` no host (Docker no Mac não usa a GPU/Metal) e `ollama pull qwen2.5:7b` | `LLM_PROVIDER=ollama`, `COMPOSE_PROFILES=` e `OLLAMA_BASE_URL=http://host.docker.internal:11434` |
| Linux com RAM sobrando | container do compose (perfil `ollama`) | `LLM_PROVIDER=ollama`, `COMPOSE_PROFILES=ollama` e `OLLAMA_BASE_URL=http://ollama:11434`; depois `docker compose exec ollama ollama pull qwen2.5:7b` |

A imagem `ollama/ollama` tem ~2,8 GB comprimida (arm64). O modelo escolhido na Fase 4 é `qwen2.5:7b` (ver `docs/fases/fase-4.md`).

### VPS de 4 GB: limites, swap e medição

- Todo container tem `mem_limit` (variáveis `*_MEM_LIMIT` no `.env.example`); o heap do Node fica abaixo do limite (`NODE_OPTIONS`). O MySQL do WA-AKG sobe com buffer reduzido e sem `performance_schema`; o Postgres do bot com `shared_buffers` de 48 MB.
- `sudo ./scripts/setup-swap.sh [GB]` cria um swapfile (padrão 2 GB, `swappiness=10`) na VPS. É rede de segurança, não extensão de RAM.
- Imagens: construa fora da VPS (CI ou máquina local) e baixe de um registry; o build do WA-AKG (Next.js) estoura a memória de uma VPS pequena.
- Medição: `./scripts/measure-memory.sh -- node scripts/simulate-load.mjs --secret <WA_AKG_WEBHOOK_SECRET>` amostra o `docker stats` durante conversas simuladas e falha se a soma dos picos passar de 2,5 GB. Sem número de WhatsApp conectado o envio falha e a carga trava em retry: suba `node scripts/fake-wa-akg.mjs` e rode o bot com `WA_AKG_BASE_URL=http://host.docker.internal:3999 TYPING_MAX_MS=0 docker compose up -d bot`. Os telefones simulados (`5511900000001`...) precisam estar em `ALLOWED_PHONES`. Resultado em `docs/fases/fase-11b.md`.

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

Entregas de saída (CRM e aviso ao corretor, Fase 6): tabela `delivery_jobs` (`PENDING`, `PROCESSING`, `DONE`, `DEAD`; inspecionar `attempts` e `last_error`), com as variáveis `DELIVERY_POLL_MS`, `DELIVERY_LOCK_MS`, `DELIVERY_MAX_ATTEMPTS`. O container do bot não aplica migrations: depois de atualizar, rode `./scripts/db-setup.sh`. Os telefones dos corretores precisam estar em `ALLOWED_PHONES`.

## Comandos úteis

```bash
docker compose ps
docker compose logs -f bot            # logs JSON; telefone mascarado, conteúdo não é logado
curl --cacert certs/dev-ca.crt https://localhost:3100/health/deps
docker compose down                   # para (mantém volumes)
docker compose down -v                # apaga também os dados (MySQL do WA-AKG, Postgres, sessão do WhatsApp)
```

Espaço em disco: o build do WA-AKG deixa ~2 GB de cache de build; `docker builder prune` libera (atenção: apaga o cache de build de todos os projetos).

## Exclusão de dados do titular (LGPD)

Quando o lead confirma "apagar meus dados", o bot apaga tudo do lado dele (banco do bot, CRM simulado, fila) e deixa uma pendência para o histórico que o WA-AKG guarda no MySQL dele (o WA-AKG não tem endpoint para apagar). Para concluir:

```bash
./scripts/wa-akg-erase.sh --dry-run   # quantas limpezas estão pendentes
./scripts/wa-akg-erase.sh             # apaga mensagens, contato e etiquetas no WA-AKG e fecha a pendência
```

Rode depois de cada pedido de exclusão (ou agende de hora em hora). Não cobre arquivos de mídia no volume do WA-AKG nem as mensagens que já estão no aparelho do número do piloto. A retenção automática de leads inativos é `LEAD_RETENTION_DAYS` (padrão 180; 0 desliga).
