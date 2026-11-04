# 05 — Runbook do piloto

Para quem opera o bot durante o piloto. Comandos a partir de `infra/`, salvo indicação. Detalhes de instalação: [`infra/README.md`](../infra/README.md).

## Antes de abrir o piloto

1. `docker compose ps`: `wa-akg`, `wa-akg-db`, `bot`, `bot-db` saudáveis; Ollama respondendo.
2. `curl --cacert certs/dev-ca.crt https://localhost:3100/health/deps` → `{"status":"ok"}` (Postgres e Ollama).
3. `./scripts/db-setup.sh`: migrations aplicadas e parâmetros vigentes listados (confira a versão).
4. Corretores reais cadastrados (telefone na tabela `brokers`) **e** em `ALLOWED_PHONES`, junto com o número dos leads do piloto.
5. Sessão `piloto` conectada no dashboard do WA-AKG (número dedicado, nunca o principal).
6. Mande "oi" do número de um lead de teste e faça uma conversa inteira até o PDF chegar ao corretor.

## Dia a dia

| O que olhar | Como |
|---|---|
| Logs | `docker compose logs -f bot` (JSON). Um registro `turno da conversa` por mensagem, com `conversationId`, `from`→`to` (estados), `replies`, `jobs`; `mensagem processada` traz `durationMs`. Sem telefone, nome nem valores. |
| Seguir uma conversa | filtre por `conversationId`: `docker compose logs bot \| grep <id>` |
| Fila de entrada | `select status, count(*) from processed_messages group by 1;` (`DEAD` = esgotou tentativas; ver `last_error`) |
| Entregas (CRM/corretor) | `select kind, status, attempts, last_error from delivery_jobs where status <> 'DONE' order by created_at;` |
| Atendimentos em handoff | o corretor manda `pendentes` ao número do bot |
| Pedidos de exclusão pendentes no WA-AKG | `./scripts/wa-akg-erase.sh --dry-run` |

Consultas no banco: `docker compose exec bot-db psql -U bot -d bot`.

## Situações comuns

**O bot não responde ninguém.** (1) `docker compose logs --tail 50 bot`. (2) `/health/deps`: Postgres fora derruba tudo; Ollama fora só desliga o fallback de linguagem (os parsers continuam). (3) Sessão do WhatsApp desconectada no dashboard do WA-AKG: reescanear o QR. (4) Número fora de `ALLOWED_PHONES`: o webhook descarta com aviso no log.

**Mensagem do lead não chegou.** O WA-AKG tenta o webhook uma vez só (timeout 10 s). Se o bot estava fora do ar, a mensagem se perdeu: peça ao lead para reenviar. Confira `processed_messages` pelo `external_id`.

**Mensagem `DEAD`.** `last_error` diz o motivo (já mascarado). Corrigida a causa: `update processed_messages set status='PENDING', attempts=0, next_attempt_at=now(), last_error=null where id='...';`. Se for dado inválido, deixe como está e fale com o lead.

**Corretor não recebeu o card/PDF.** `delivery_jobs` com `PENDING` e `attempts` subindo = reenviando com espera; `DEAD` = esgotou (8 tentativas). Causas típicas: telefone do corretor fora de `ALLOWED_PHONES` ou sessão caída. Para reenviar: mesmo `update` acima na tabela `delivery_jobs`.

**Lead em rajada ou colando texto enorme.** O bot descarta acima de `RATE_LIMIT_PER_MIN` (30) mensagens por minuto por conversa e corta textos acima de `MAX_TEXT_CHARS` (2000). Aparece como `limite de mensagens por conversa excedido` no log.

**LLM lento ou travado.** Cada chamada tem `LLM_TIMEOUT_MS` (20 s); passado o prazo o bot segue só com os parsers. Para desligar de vez: `LLM_ENABLED=false` e `docker compose up -d bot`.

**Taxas ou faixas mudaram.** `pnpm --filter @mvp/db params set ...` (nova versão com vigência e auditoria; ver [`packages/db/README.md`](../packages/db/README.md#cli-de-parâmetros)). Simulações já feitas guardam a versão antiga. Os parâmetros do seed são **ILUSTRATIVOS**: nada de piloto com leads reais antes de o financeiro validar.

**Pedido de exclusão (LGPD).** O bot apaga o lado dele na hora. Rode `./scripts/wa-akg-erase.sh --dry-run` e depois sem `--dry-run` (de hora em hora ou ao fim do dia). Avise o corretor que a cópia dele também deve ser apagada (o bot já avisa por mensagem).

**Suspeita de bloqueio do número.** Pare o envio (`docker compose stop bot`), não crie outro número às pressas, avalie com o time. Risco conhecido do WA-AKG (não oficial): piloto pequeno, só com opt-in.

## Parar e subir

```bash
docker compose stop bot      # encerra a mensagem em curso e para (SIGTERM); a fila fica no banco
docker compose up -d bot     # retoma de onde parou; mensagens em andamento voltam sozinhas após INBOX_LOCK_MS
```

## Backup

Dados vivos: volume do `bot-db` (Postgres do bot) e do `wa-akg-db` (MySQL do WA-AKG, com sessão do WhatsApp). Antes de qualquer atualização: `docker compose exec bot-db pg_dump -U bot bot > backup-$(date +%F).sql` (contém dados pessoais: guarde cifrado e apague pela retenção).

## Atualizar o bot

1. `git pull`, `pnpm check` (tudo verde).
2. `docker compose up -d --build bot`.
3. `./scripts/db-setup.sh` (o container não aplica migrations).
4. Conferir `/health/deps` e uma conversa de teste.
