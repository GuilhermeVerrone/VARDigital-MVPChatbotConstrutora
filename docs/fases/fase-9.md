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

### §3.1 Ambiente Docker
Não rebuildei o ambiente local para não mexer nos containers em uso. Passos:
1. `infra/scripts/db-setup.sh`
2. `docker compose up -d --build bot` (em `infra/`)
3. Trocar os telefones dos corretores do seed (DDD 00) e incluí-los em `ALLOWED_PHONES`.

### Testes no WhatsApp real (número dedicado)
Registrar cada resultado com print ou log.

1. **Botões do `/interactive`** — aparecem? funcionam no Android, iOS e web? — _não testado_
2. **Envio ativo** para número que nunca falou com a sessão — _não testado_
3. **Resposta a esse envio**: chega como `@lid` ou telefone? — _não testado_
4. **Checagem de número no WA-AKG (G20)** — existe? — _não testado_

### Decisões que dependem dos testes
- Botões: adotar `sendButtons` (Fase 12) ou manter texto numerado.
- Casamento do lead por LID ou só por telefone/código `ELV-xxxx`.

## Fora desta fase
§3.4 (tolerância da parcela nos parâmetros) já foi tratada na Fase 10 (migration `desired_installment_tolerance`). §3.7 (tom das mensagens) segue aberto.
