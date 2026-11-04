# Fase 9 — Fechar o MVP e testar os riscos no aparelho

**Status:** parcial. As correções de código e documentação estão feitas. Os 4 testes no WhatsApp real **não foram executados**: exigem o número dedicado, um celular e a stack conectada, que o agente não tem.

## Feito (com `pnpm check` verde, 471 testes)

| Item | O que mudou |
|---|---|
| [06-check §3.2](../06-check-projeto.md) | Exemplos de telefone em `templates.ts` (`askPhone`) e `steps.ts` agora usam o fictício `(11) 91234-5678`. `infra/.env.example` traz `ALLOWED_PHONES=5511912345678` com aviso de que é fictício (a config exige ao menos um telefone, por isso não ficou vazio). |
| §3.3 | Optou-se por **não prometer o registro**: o texto do FAQ agora diz que o corretor pode responder quando falar com o lead. Registrar as dúvidas no dossiê fica para a Fase 12, junto com o dossiê v2. |
| §3.5 | `fase-8.md` corrigido: itens 2 e 3 do `ajustes.txt` já estavam resolvidos. |
| Aceite (`pnpm check`) | Dois ajustes que o deixavam vermelho na `main`: `schema.test.ts` inseria `parameter_sets` sem a coluna NOT NULL `desired_installment_tolerance_ratio` (Fase 10), e o ESLint lia scripts vendorizados de `.claude/skills` (agora ignorados, junto com `elevare-construtora/`). |

## Pendente — exige o aparelho

### §3.1 Ambiente Docker — feito em 2026-11-04, falta só os corretores
- `infra/scripts/db-setup.sh`: todas as migrations aplicadas (incl. handoff/exclusão e tolerância da parcela) e seed idempotente sem mudar os parâmetros (`2026-10-ILUSTRATIVO-v1`).
- `docker compose up -d --build bot`: container recriado, `healthy`, log "bot pronto" (sessão `piloto`, retenção 180 dias, TLS).
- Corretores: o 1º virou "Corretor A" (`5513981264295`, já em `ALLOWED_PHONES`); o 2º, ainda fictício, foi desativado até haver número real. O corretor A é o mesmo número do piloto, então handoff e lead partilham o celular.
- A sessão `piloto` do WA-AKG estava `STOPPED`; `POST /api/sessions/piloto/start` reconectou (`CONNECTED`) sem QR.

### Testes no WhatsApp real (número dedicado)
Registrar cada resultado com print ou log.

1. **Botões do `/interactive`** — enviado em 2026-11-04 para o piloto: `POST /api/messages/piloto/{jid}/interactive` com `body`, `footer` e 2 `buttons` `{id,text}` → API respondeu sucesso (`nativeFlowMessage` com 2 `quick_reply`, status `PENDING`). **Resultado no aparelho (informado pelo usuário): a mensagem com botões NÃO chegou.** Controle: um texto simples (`/send`) enviado logo depois, ao mesmo número, chegou. Logo a sessão entrega, e o WhatsApp descartou a mensagem interativa. Limite do teste: um único aparelho/cliente (plataforma não registrada); iOS e web não foram testados e a mensagem foi enviada ao próprio número do piloto.
2. **Envio ativo** para número que nunca falou com a sessão — _não testado_
3. **Resposta a esse envio**: chega como `@lid` ou telefone? — _não testado_
4. **Checagem de número no WA-AKG (G20)** — **existe**: `POST /api/chat/{sessão}/check` com `{"numbers":[...]}` devolve `{number, exists, jid}`. Teste: `5513981264295` → `exists:true`, `jid` `@s.whatsapp.net`; `5500900000002` → `exists:false`, `jid:null`; também aceita o JID completo. Dá para validar o telefone do formulário antes do 1º contato (Fase 13).

### Decisões que dependem dos testes
- Botões: **decisão proposta: manter o texto numerado e não implementar `sendButtons` na Fase 12** (a mensagem interativa não chegou no aparelho testado). Reabrir só se um teste em outro aparelho mostrar o contrário.
- Casamento do lead por LID ou só por telefone/código `ELV-xxxx`.

## Fora desta fase
§3.4 (tolerância da parcela nos parâmetros) já foi tratada na Fase 10 (migration `desired_installment_tolerance`). §3.7 (tom das mensagens) segue aberto.
