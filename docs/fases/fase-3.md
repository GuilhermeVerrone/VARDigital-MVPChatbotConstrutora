STATUS: PASS

# Fase 3 — Canal: ingress, fila e envio

**Execução real (2026-10-29):** com a stack no Docker e a sessão `piloto` conectada, duas mensagens de texto do 13981264295 chegaram como `message.received` (remetente `@s.whatsapp.net`, sem LID), foram gravadas e processadas na 1ª tentativa (`DONE`, sem erro de envio ao WA-AKG). A imagem Docker do bot compilou e subiu com TLS. O recebimento do eco no celular foi confirmado pelo usuário.

**Resumo (antes da execução real):** o caminho webhook → fila Postgres → worker → canal está implementado e passou em testes automatizados e num teste de fumaça do bundle real contra Postgres real (com um WA-AKG simulado). **Não** havia sido testado com WhatsApp real nem com a imagem Docker; isso foi feito depois, como descrito acima.

## O que foi feito

- **`ChannelAdapter` + `WaAkgAdapter`** (`packages/channel`): `sendText`, `sendList` (lista numerada em texto, `legacyText`), `sendDocument` (PDF por multipart), `setPresence` ("digitando…") e `markRead`. Rotas conferidas no código do WA-AKG v1.7.0 em `vendor/`. Erros viram `ChannelError` com `retryable` (rede, 5xx, 408, 429 e `status:false` com HTTP 200 = transitório; 400/401/403/404 = permanente).
- **Parser do webhook** (`parseWaAkgWebhook`): normaliza `message.received` e ignora, com o motivo: outros eventos, `fromMe`, grupos, status/canais e outra sessão. `phone` só é preenchido para JID de telefone; LID chega com `phone = null` e o `chatId` original (é para onde se responde).
- **Fila em Postgres** (`packages/db/src/inbox.ts`, migration `20261029120000_inbox_queue`): a tabela `processed_messages` virou fila + idempotência. Colunas novas: status (`PENDING/PROCESSING/DONE/DEAD`), `payload`, tentativas, `available_at` (backoff), `locked_until` (reserva), `last_error`, `chat_key`.
- **Ingress** (`apps/bot`): valida HMAC, filtra, grava e responde 200. Reentrega responde 200 com `duplicate:true`. Falha ao gravar responde 500 e fica no log.
- **Worker**: uma mensagem por vez, backoff exponencial (5 s … 5 min), `DEAD` após `INBOX_MAX_ATTEMPTS` (5) ou na primeira falha permanente, encerramento limpo (termina a mensagem em curso).
- **Eco** provisório: marca como lida, "digitando…", responde `Eco: <texto>`, volta a "pausado". Tipos sem texto recebem um aviso.
- **Bundle do bot passou a ser ESM** (`dist/main.mjs`). Como o bot agora importa `@mvp/db`, o bundle CJS quebrava ao iniciar (`import.meta` do Prisma). Achado no teste de fumaça, corrigido. Dockerfile e compose ajustados.

## Decisões

1. **Reaproveitar `processed_messages` como fila**, em vez de criar outra tabela: o índice único (canal, sessão, `key.id`) já é a idempotência e a fila herda essa garantia sem coordenação extra.
2. **Conteúdo some ao concluir.** `payload` (texto e telefone) existe só enquanto a mensagem está na fila; ao concluir vira `NULL`. Mensagens `DEAD` mantêm o payload para inspeção (retenção: Fase 7).
3. **Ordem por conversa.** Uma mensagem só é reservada se não houver anterior da mesma conversa em `PENDING`/`PROCESSING`. Efeito: uma mensagem em backoff segura as seguintes daquela conversa; outras conversas seguem. Reserva vencida que já gastou as tentativas vira `DEAD` para não travar a conversa.
4. **Entrega "pelo menos uma vez" na saída.** Se o processo cair depois de enviar e antes de concluir, a mensagem volta e o eco é enviado de novo. A idempotência garantida é a da **entrada**. O orquestrador (Fase 5) deve tratar isso (estado por etapa) ao responder.
5. **Concorrência 1** no worker (coerente com LLM local e dezenas de conversas). A fila já é segura para vários workers (`FOR UPDATE SKIP LOCKED`), mas isso não foi exercitado com vários processos.
6. **Lista sempre em texto numerado** (`legacyText`), porque botões/lista nativos continuam não verificados em número real.
7. **Lista de telefones permitidos (`ALLOWED_PHONES`, obrigatória).** Por enquanto só `13981264295`. Dupla trava: o webhook descarta quem não está na lista (nada é gravado) e o canal de saída (`restrictChannel`) recusa qualquer envio, presença ou leitura para fora dela. Compara ignorando DDI 55 e o nono dígito (o JID pode vir como `551381264295`). Remetente `@lid` sem telefone resolvido é descartado, porque não dá para verificar; se o seu número chegar assim, aparece no log como "fora da lista" e é preciso ajustar.
8. `WA_AKG_API_KEY` é obrigatória no bot; no compose o default é vazio (a chave só existe depois do `wa-akg-bootstrap.sh`), então o bot falha com mensagem clara até a chave ser configurada.

## Resultado dos testes

`pnpm check` (lint + typecheck + testes) passou: **239 testes** (163 anteriores + 76 novos). Log em `logs/fase-3.log`.

| Critério de aceite | Evidência |
|---|---|
| Gravada e processada uma única vez mesmo com reentrega | `pipeline.test.ts` (4 entregas simultâneas + 1 tardia → 1 linha, 1 eco); `inbox.test.ts` (corrida de 8 `enqueue`); fumaça com o bundle: 4 POSTs simultâneos → 1 eco |
| Derrubar o worker e subir de novo não perde mensagem | `pipeline.test.ts`: worker parado (3 mensagens, depois processadas em ordem); worker que reserva e morre (retomado após o `lockedUntil`); fumaça com `kill -9` do bot: mensagem pendente entregue uma vez após reiniciar (2 tentativas) |
| Resposta de eco com "digitando…" | `echo.test.ts` e `pipeline.test.ts`: sequência `read → composing → send → paused`; fumaça confirmou as 4 chamadas HTTP ao WA-AKG simulado, com `X-API-Key` |

Sensibilidade (teste de mutação manual): tirar o `skipDuplicates` derrubou 4 testes; neutralizar a regra de ordem por conversa derrubou 2. Código restaurado depois.

## Não verificado

- **Formato de outros tipos de mensagem** (áudio, imagem, contato novo que cairia em `@lid`): só o texto foi exercitado com WhatsApp real.
- **Rotas `list` e `media` (PDF)** contra o WA-AKG real: só teste unitário do adaptador.
- **Postgres 16-alpine do compose.** Os testes rodam no Postgres do Homebrew; a migration nova só usa SQL padrão e `FOR UPDATE SKIP LOCKED`.
- **Vários workers/processos** concorrentes.

## Riscos

- **Ingress sem retry do WA-AKG (herdado da Fase 0).** Se o bot estiver fora do ar quando a mensagem chega, ela se perde: a fila só protege depois do webhook gravar. A reconciliação pelos logs de entrega do WA-AKG (`GET /api/webhooks/{session}/{id}/logs`), sugerida na Fase 0, **não foi implementada**; fica como item do endurecimento (Fase 8) ou antes, se o piloto exigir.
- Resposta duplicada possível em queda entre envio e conclusão (decisão 4).
- Mensagem `DEAD` fica sem resposta ao lead e sem alerta; hoje só aparece em `last_error`. Alertar é Fase 8.
- Conversa bloqueada em backoff: uma mensagem que falha repetidamente atrasa as seguintes daquela conversa (até ~5 min por tentativa) antes de virar `DEAD`.
