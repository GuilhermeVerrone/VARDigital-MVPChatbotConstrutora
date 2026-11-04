# 06 — Check do projeto contra as decisões iniciais

Data: 2026-11-04. Base: `spec.md`, [`01-prompt-guide.md`](01-prompt-guide.md), [`03-impactos.md`](03-impactos.md), [`04-plano.md`](04-plano.md) e relatórios em [`fases/`](fases/).

**Resumo:** o código segue as decisões e `pnpm check` passa inteiro (lint, typecheck e **471/471 testes**, 35 arquivos). O ambiente Docker em execução, porém, roda uma versão anterior às Fases 7 e 8, e há alguns desvios pequenos para corrigir antes do piloto.

## 1. Decisões aprovadas (D1–D5)

| Decisão | Situação | Evidência |
|---|---|---|
| D1 — WA-AKG só no piloto, atrás de adaptador | ✅ | O orquestrador só usa `ChannelAdapter`; o WA-AKG aparece apenas em `main.ts` e na rota do webhook. `vendor/wa-akg` fixo no commit `936b26b` (v1.7.0), sem alterações |
| D2 — Node + TypeScript | ✅ | Fastify, Prisma, Zod, Vitest |
| D3 — LLM local, parsers primeiro | ✅ | `presentation` não depende de `@mvp/llm`; `simulation` é puro (só `zod`); teste confere cada número das mensagens contra o motor |
| D4 — CRM simulado | ✅ | `CrmAdapter` com teste de contrato + `SimulatedCrm` |
| D5 — Postgres separado do WA-AKG | ✅ | Redes Docker separadas (`wa-akg-internal`, `bot-internal`), portas só em `127.0.0.1`, fila em Postgres, sem Redis |

## 2. Regras do prompt guide

| Regra | Situação |
|---|---|
| Nenhum segredo no repositório | ✅ Só `infra/.env.example`, com segredos vazios |
| Cálculo sempre determinístico, LLM nunca calcula | ✅ |
| Regras financeiras em tabelas versionadas, nunca hardcoded | ⚠️ Uma exceção (ver 3.4) |
| Dados pessoais mascarados em logs | ✅ No código (Fase 7); ainda não no ambiente em execução (ver 3.1) |
| Consentimento antes de qualquer dado; nunca pedir CPF/RG/cartão | ✅ |
| Prompts versionados em `prompts/` | ✅ `extraction.v1.md`, `extraction.v2.md` |
| Commits em português; uma fase = um branch | ⚠️ Commits em inglês e tudo na `main` |

## 3. Problemas encontrados (por prioridade)

### 3.1 Ambiente Docker desatualizado — **alta**
- O container `bot` foi criado em 2026-10-30 (antes das Fases 7 e 8).
- O banco `bot-db` não tem a migration `20261104120000_handoff_and_erasure`.
- Consequência: o que está rodando **não tem** handoff, exclusão de dados, mascaramento nos logs, retenção nem limite de mensagens.
- Os corretores no banco ainda são os fictícios do seed (DDD 00).
- **Correção:** `infra/scripts/db-setup.sh` → `docker compose up -d --build bot` (em `infra/`) → trocar os telefones dos corretores e incluí-los em `ALLOWED_PHONES`.

### 3.2 Número real usado como exemplo para os leads — **alta**
- O número de teste do piloto, `(13) 98126-4295`, aparece como exemplo de formato para todo lead:
  - [`templates.ts:29`](../packages/conversation/src/templates.ts#L29) (`askPhone`)
  - [`steps.ts:80`](../packages/conversation/src/steps.ts#L80) (dica de reformulação)
  - [`infra/.env.example:26`](../infra/.env.example#L26) (`ALLOWED_PHONES`)
- O lead pode achar que é o número da construtora e escrever para ele.
- **Correção:** trocar por um número fictício (ex.: `(11) 91234-5678`) nos textos e deixar `ALLOWED_PHONES` vazio no exemplo. Os testes podem continuar com ele ou passar a usar o fictício.

### 3.3 FAQ promete algo que não acontece — **média**
- O bot diz: "vou deixar anotada para o corretor responder com precisão".
- Em [`machine.ts:264-265`](../packages/conversation/src/machine.ts#L264-L265) a pergunta não é registrada, e o dossiê do corretor não tem campo para ela. Só chega ao corretor se houver handoff, porque o card leva as últimas 14 mensagens.
- **Correção:** guardar as perguntas de FAQ na conversa e listá-las no dossiê ("Dúvidas do lead"), ou trocar o texto para não prometer o registro.

### 3.4 Regra financeira no código — **média**
- A folga de 15% sobre a parcela desejada está fixa em [`simulate.ts:10`](../packages/simulation/src/simulate.ts#L10) (`DESIRED_INSTALLMENT_TOLERANCE_RATIO = 0.15`).
- Pela regra do projeto (spec §7.5) ela deveria estar nos parâmetros com vigência, como `adjustmentToleranceRatio`.
- **Correção:** mover para `SimulationParameters` e para o seed ILUSTRATIVO.

### 3.5 Relatório da Fase 8 incorreto sobre o `ajustes.txt` — **baixa**
- [`fase-8.md`](fases/fase-8.md) diz que nenhum item do `ajustes.txt` foi tratado.
- Os itens **2** (pergunta da parcela) e **3** ("não" não entendido) foram resolvidos em 2026-10-30, depois de o arquivo ser escrito (14:43): commits `c3f629d` (18:51) e `2393979` (19:10), com testes em `machine.test.ts`.
- Continuam abertos o **item 1 (botões)** e o **item 4 (tom menos robotizado)**.
- **Correção:** atualizar a seção "Não verificado" da Fase 8.

### 3.6 Botões de resposta rápida (item 1 do `ajustes.txt`) — **decisão pendente**
- Vai contra a decisão de [`03-impactos.md`](03-impactos.md) §4: usar texto numerado até confirmar num celular real que os botões aparecem (G5 do discovery, `[verificar com número real]`).
- O `ChannelAdapter` hoje não tem método de botões; `sendList` usa `legacyText: true`.
- **Próximo passo:** testar `/interactive` do WA-AKG no aparelho. Se os botões aparecerem, acrescentar `sendButtons` ao `ChannelAdapter` (sempre com o texto "sim/não" como alternativa).

### 3.7 Tom das mensagens (item 4 do `ajustes.txt`) — **média**
- As mensagens de [`templates.ts`](../packages/conversation/src/templates.ts) são corretas, mas formais e repetitivas ("Certo, …", "(sim/não)" em toda pergunta).
- **Próximo passo:** revisar os textos (variação de confirmações, menos "(sim/não)", quebras de linha, emoji pontual), mantendo uma pergunta por vez e nenhum número fora do motor.

### 3.8 Pontos menores
- **Renda inconsistente** (spec §12, ex.: R$ 5): só exige valor maior que zero; não pede confirmação na hora. Fica mitigado pelo resumo de confirmação antes do cálculo.
- **FAQ (RF-06):** só redireciona; não há busca em base cadastrada (estava como "FAQ mínimo" no escopo do MVP).
- **Processo:** commits em inglês e sem branch por fase, diferente das convenções do prompt guide.

## 4. Critérios de aceite do MVP (spec §13)

Concordo com a tabela da [Fase 8](fases/fase-8.md#checklist-de-aceite-do-mvp-spec-13):

- **OK em teste automatizado:** consentimento antes da coleta, parecer coerente, CRM sem duplicidade, handoff em qualquer etapa, valores só do motor, exclusão de dados.
- **Pendente de entrada externa:** planilha de referência do financeiro (SAC/Price) e texto jurídico (consentimento, avisos, retenção).
- **Fora do MVP:** painel de parâmetros e de métricas (hoje CLI com auditoria e logs).
- **Não cumprido:** o critério de aceite da Fase 8, **piloto com número dedicado e leads com opt-in**. Nada foi testado no WhatsApp real desde a Fase 3.

## 5. Ordem sugerida

1. Corrigir 3.2, 3.3 e 3.4 e atualizar o relatório da Fase 8 (3.5).
2. Revisar o tom das mensagens (3.7).
3. Atualizar o ambiente Docker e colocar corretores reais (3.1).
4. Rodar os roteiros da Fase 8 no celular, incluindo o teste de `/interactive` para decidir sobre os botões (3.6).
5. Abrir o piloto seguindo o [runbook](05-runbook.md).
