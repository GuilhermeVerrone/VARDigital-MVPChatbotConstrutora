# @mvp/db — dados e parâmetros com vigência

Banco do bot (PostgreSQL **separado** do WA-AKG, decisão D5), via Prisma 7 (`prisma-client` + `@prisma/adapter-pg`, sem engine binária em runtime). Contém o schema (spec §10), as migrations, o seed, o repositório de parâmetros financeiros com **vigência por data** e **auditoria**, a CLI que substitui o painel de parâmetros no MVP (RF-47, RF-52) e o serviço que roda o motor com os parâmetros vigentes e grava a simulação.

> **Dados ILUSTRATIVOS.** O seed (`seed/catalog-ilustrativo.json` + parâmetros do motor) é inventado. Telefones com DDD 00 e e-mails `.invalid` não alcançam ninguém. Em produção, use `rejectIllustrative: true` (recusa simular com parâmetros não validados pelo financeiro).

## Modelo (spec §10 → schema)

| Spec | Model / tabela | Observação |
|---|---|---|
| Lead | `Lead` / `leads` | `phone` único (RF-41); `channelJid` guarda o JID, inclusive `@lid` sem telefone |
| Consentimento | `Consent` / `consents` | 1 lead → N consentimentos (histórico de aceite/revogação); `textVersion`, `channel`, `acceptedAt`, `revokedAt` |
| Conversa | `Conversation` / `conversations` | `state`, `context` (dados ainda não confirmados), `history`, `handoff` |
| PerfilFinanceiro | `FinancialProfile` / `financial_profiles` | Co-proponente com tipo de renda, dívidas e FGTS (o motor precisa) |
| Empreendimento | `Development` / `developments` | + fluxo de obra (sinal, reforços, intervalo) e `dataStatus` |
| Unidade | `Unit` / `units` | `status` AVAILABLE/RESERVED/SOLD; único por (empreendimento, código) |
| Simulacao | `Simulation` / `simulations` | `parametersVersion` (= `parametros_versao`) + FK `parameterSetId` e `creditLineId`; entrada e resultado completos em JSON |
| LinhaCredito | `CreditLine` / `credit_lines` | Pertence a uma versão (`ParameterSet`); a vigência (`vigencia_inicio/fim`) é a da versão |
| — | `ParameterSet` / `parameter_sets` | Versão do conjunto de parâmetros: `version`, `status`, `validFrom`, `validTo`, parâmetros globais |
| Corretor | `Broker` / `brokers` | `lastAssignedAt` para o round-robin da Fase 6 |
| LogAuditoria | `AuditLog` / `audit_logs` | `actor` (texto; não há tabela de usuários no MVP), `entity`, `entityId`, `action`, `before`, `after`, `reason`, `at` |
| MensagemProcessada | `ProcessedMessage` / `processed_messages` | Único por (canal, sessão, `key.id`): idempotência **e fila de entrada** da Fase 3 (status, tentativas, reserva, payload temporário). Ver `src/inbox.ts` |

Fora do MVP (sem tabela ainda): `DistribuicaoLead`, `ResultadoContato`.

### V2 (Fase 11)

Migration aditiva `20261105120000_v2_data_model` (ver `docs/v2/03-impactos.md` §3). Dados `ILUSTRATIVO` até a construtora validar (D9).

| Model / tabela | O que é |
|---|---|
| `SalesCondition` / `sales_conditions` | Condição comercial **por empreendimento**, versionada, com vigência e imutável (mesmo padrão do `ParameterSet`). Vigência, status e autoria em colunas; as regras (3 modos de pagamento) em `rules` (JSON validado pelo `salesConditionSchema` do motor). Repositório em `src/sales-conditions/repository.ts`. |
| `FlowConfig` / `flow_configs` | Fluxo do bot editável: rascunho → publicada → aposentada. Publicada é imutável. Sem versão publicada, o bot usa `templates.ts`. `src/flow-config.ts`. |
| `User` e `UserSession` / `users`, `user_sessions` | Usuários do painel (`ADMIN`, `GERENTE`, `CORRETOR`), senha argon2id, sessão por token (só o hash fica no banco), bloqueio após 5 erros. `src/users.ts`. |

Campos novos: `Lead` (`developmentId`, `source`, `utm`, `formSubmittedAt`, `contactConfirmedAt`, `paymentMode`), `Simulation` (`paymentMode`, `salesConditionId`, `downPaymentPlan`, `bankEstimate`; `parameterSetId` e `parametersVersion` agora opcionais), `FinancialProfile` (`cashNow`, `acceptsBalloons`), `Development` (`published`, `heroImage`, `address`, `highlights`, `gallery`) e o tipo `FIRST_CONTACT` em `DeliveryJob` (fora da reserva padrão do worker até a Fase 13). Os campos `signalRatio`/`balloonRatio`/`balloonIntervalMonths` de `Development` seguem na tabela só para o motor do MVP.

Garantias no banco: `sales_conditions_no_overlap` (exclusão por empreendimento e vigência, exige `btree_gist`), `sales_conditions_guard` (imutável, não se apaga) e `flow_configs_guard` (publicada só pode virar aposentada).

**Simulação por modo:** `runAndRecordPaymentSimulation` lê a condição vigente na data, roda `simulatePayment` e grava o modo, o plano e as versões usadas (condição e, se houve estimativa do banco, parâmetros).

### Garantias no próprio banco (migration, SQL à mão)

- `parameter_sets_no_overlap`: restrição de exclusão (`daterange [valid_from, valid_to]`); nunca há duas versões ativas na mesma data.
- `parameter_sets_guard`: versão é imutável; só `valid_to` (encerrar) e `superseded_by_id` (substituir) mudam; não se apaga.
- `credit_lines` e `audit_logs`: somente inserção (trigger bloqueia UPDATE/DELETE).

O Prisma não modela essas peças, mas também não tenta removê-las: `prisma migrate diff` continua vazio (há teste para isso).

## Vigência: como funciona

Cada versão vale em `[validFrom, validTo]` (datas inclusivas, `validTo` nulo = sem fim). Publicar a partir da data **F**:

- a versão vigente em F passa a terminar em **F − 1** (ou é **substituída**, se começava exatamente em F, e continua no histórico);
- a nova herda o fim da anterior;
- vigência no passado exige `--allow-retroactive`; publicar antes de uma versão futura já agendada é recusado;
- valor que não cabe na precisão da coluna (ex.: taxa com 9 casas) é recusado em vez de arredondado em silêncio.

Simular na data D usa a versão vigente em D (`getParametersInForce`). A simulação grava a versão usada. Simulações antigas não mudam quando os parâmetros mudam.

## CLI de parâmetros

`BOT_DATABASE_URL` aponta para o banco (no compose de dev: `postgresql://bot:<BOT_DB_PASSWORD>@127.0.0.1:5433/bot`).

```bash
pnpm --filter @mvp/db params show [--date 2026-11-01 | --version V] [--json]
pnpm --filter @mvp/db params history
pnpm --filter @mvp/db params set --set lines.sbpe.annualInterestRate=0.1199 \
     --from 2026-11-01 --by ana.financeiro --reason "tabela nov/26" [--dry-run]
pnpm --filter @mvp/db params import tabela.json --version fin-2026-12 \
     --from 2026-12-01 --by financeiro --reason "tabela validada" [--dry-run]
```

- Caminhos de `--set`: campo global (`adjustmentToleranceRatio`, `highCommitmentAlertRatio`, `defaultSystem`, `informalIncomeTypes`, `status`) ou `lines.<id>.<campo>` (ex.: `lines.sbpe.insurance.dfiMonthlyRate`, `lines.programa-habitacional-faixa-a.subsidy`). O valor é JSON quando possível (`0.12`, `true`, `null`, `[...]`), senão texto. Listas são trocadas inteiras.
- Validar a tabela com o financeiro: `--set status=VALIDADO` (fica auditado como qualquer alteração), ou `import` de um arquivo gerado por `show --json` e editado.
- Incluir/remover linhas de crédito: `import`.
- Código de saída: 0 ok; 1 regra violada (nada gravado); 2 uso incorreto.

## Comandos

```bash
pnpm --filter @mvp/db generate          # gera o client em src/generated (também roda no pnpm install)
pnpm --filter @mvp/db migrate:deploy    # aplica migrations (BOT_DATABASE_URL)
pnpm --filter @mvp/db migrate:dev       # cria migration nova a partir do schema (dev)
pnpm --filter @mvp/db db:seed           # seed idempotente (V2: 3 empreendimentos Elevare; SEED_CATALOG=exemplo usa o do MVP)
pnpm --filter @mvp/db demo-reset -- --yes # apaga TUDO e refaz o seed da demo (recusa APP_ENV=production)
./infra/scripts/db-setup.sh             # migrations + seed + params show no Postgres do compose
```

## Testes

Usam **PostgreSQL de verdade**, porque as garantias de vigência e de imutabilidade estão em constraints e triggers. O `test/global-setup.ts`:

1. usa `TEST_DATABASE_URL`, se definido (o usuário precisa de `CREATE DATABASE`; ex.: `docker run -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine`); senão
2. sobe um cluster descartável com `initdb`/`pg_ctl` do PATH (Homebrew, apt); senão
3. **falha** com instrução. Não pula: teste de banco ausente não pode passar em silêncio.

As migrations do repositório são aplicadas uma vez num banco-modelo. Cada arquivo de teste clona esse modelo. Exemplo com o Postgres do compose:

```bash
TEST_DATABASE_URL="postgresql://bot:<senha>@127.0.0.1:5433/postgres" pnpm vitest run --project db
```
