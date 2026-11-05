STATUS: PASS (`pnpm lint`, `pnpm typecheck` e `vitest run` na raiz: 45 arquivos, 575 testes)

# Fase 11 — Dados v2 e multi-empreendimento

**Resumo:** o banco do bot ganhou o modelo da V2 (condição comercial versionada, fluxo do bot versionado, usuários e sessões do painel), os campos novos nas tabelas existentes, o seed dos 3 empreendimentos Elevare, a simulação por forma de pagamento gravando o modo, o plano e as versões usadas, e o script `demo-reset`. Tudo `ILUSTRATIVO` (D9).

## O que foi feito

- **Migration** [`20261105120000_v2_data_model`](../../packages/db/prisma/migrations/20261105120000_v2_data_model/migration.sql), aditiva. Única mudança em coluna existente: `simulations.parameters_version` e `parameter_set_id` aceitam nulo (o modo à vista não usa o banco). `prisma migrate diff` sai vazio (teste `schema.test.ts`).
- **`SalesCondition`**: uma linha do tempo por empreendimento, com vigência, imutável (trigger) e sem sobreposição (restrição de exclusão com `btree_gist`). Repositório [`sales-conditions/repository.ts`](../../packages/db/src/sales-conditions/repository.ts) no padrão de `parameters/repository.ts`: `findSalesConditionInForce`, `publishSalesCondition` (lock, `dryRun`, retroativo só com flag, auditoria antes/depois, encerra a anterior na véspera ou a marca como substituída).
- **`FlowConfig`**: rascunho → publicada → aposentada; publicada é imutável (trigger). [`flow-config.ts`](../../packages/db/src/flow-config.ts) cria, edita, descarta e publica com auditoria. Sem versão publicada, o bot segue com `templates.ts`.
- **`User` e `UserSession`**: [`users.ts`](../../packages/db/src/users.ts) com argon2id (`@node-rs/argon2`), sessão por token aleatório (só o hash no banco), bloqueio de 15 min após 5 erros, mesma resposta para e-mail inexistente e senha errada.
- **Campos novos** em `Lead`, `Simulation`, `FinancialProfile` e `Development`; `FIRST_CONTACT` em `JobKind`. O worker de entrega **não reserva** esse tipo por padrão (`DEFAULT_JOB_KINDS`); o tratamento dele é da Fase 13.
- **Seed Elevare** ([`seed-elevare.ts`](../../packages/db/src/seed-elevare.ts) e [`catalog-elevare.json`](../../packages/db/seed/catalog-elevare.json)): Lumen Urban, Parc Verde e Altomare (textos e imagens do site institucional), 14 unidades com preços inventados, a condição comercial de cada um, 3 corretores fictícios (DDD 00, `.invalid`) e 1 admin de demo. Idempotente; nunca altera condições nem parâmetros já publicados.
- **`runAndRecordPaymentSimulation`** em [`simulation-service.ts`](../../packages/db/src/simulation-service.ts): lê a condição vigente na data, roda `simulatePayment` e grava `paymentMode`, `salesConditionId`, `downPaymentPlan`, `bankEstimate` e, quando houve estimativa, a versão dos parâmetros. `buildPaymentInput` é pura. `isSimulationDataError` reconhece os erros novos.
- **`demo-reset`** ([`demo-reset.ts`](../../packages/db/src/demo-reset.ts), `pnpm --filter @mvp/db demo-reset -- --yes`): `TRUNCATE` de todas as tabelas e novo seed. Recusa sem `--yes` e com `APP_ENV=production`.
- **Testes no Windows**: o `global-setup.ts` e dois testes chamavam `prisma` e `tsx` sem `.CMD`. Era isso que fazia o `vitest` da raiz acusar "No test files found" (a fase 10 registrou o sintoma sem a causa).

## Aceite

| Critério | Como foi verificado |
|---|---|
| Simulação lê a condição vigente na data e grava a versão | `payment-simulation.test.ts`: 31/12 usa a v1, 01/01 usa a v2, e a simulação antiga continua apontando para a v1. |
| Publicar nova condição gera histórico e auditoria | `sales-conditions.test.ts`: `PUBLISHED` + `CLOSED`/`SUPERSEDED` com antes/depois; `dryRun` não grava. |
| `prisma migrate diff` vazio | `schema.test.ts` ("banco migrado = schema.prisma"). |
| `demo-reset` volta ao estado inicial, idempotente | `demo-reset.test.ts`: depois de lead, simulação, condição nova, rascunho de fluxo e sessão, o retrato do banco é igual ao inicial; rodar duas vezes dá o mesmo retrato. |

Testes novos: 47 no `@mvp/db` (schema da V2, condições, usuários e fluxo, seed, demo-reset, simulação por modo, fila).

## Decisões

1. **Regras da condição em JSON (`rules`)**, validadas pelo `salesConditionSchema` do motor, em vez de ~30 colunas. Vigência, status e autoria ficam em colunas para o banco garantir a linha do tempo e a imutabilidade. Trocar uma regra não exige migration.
2. **`seedDatabase` do MVP foi mantido** (Residencial Exemplo), porque os testes do bot e da conversa dependem dele. O comando `db:seed` agora semeia a Elevare; `SEED_CATALOG=exemplo` volta ao catálogo antigo. A conversa passa a escolher o empreendimento na Fase 12 (hoje `pickUnitForTypology` olha todos os empreendimentos).
3. **Estimativa do banco exige data de nascimento só se estiver ligada** na condição (D10). Ligada e sem nascimento, a simulação falha com `MissingSimulationDataError`.
4. **Senha do admin de demo** vem de `DEMO_ADMIN_PASSWORD` ou do padrão `elevare-demo-2026`. O padrão serve só para a demo e o local; trocar antes de expor a VPS.
5. **`demo-reset` usa `TRUNCATE`**, que não dispara os triggers de imutabilidade. A trava é de quem chama (`--yes` e `APP_ENV`), não do banco.

## Pendente / conhecido

- O `FormSubmission` (opcional no plano) fica para a Fase 13, junto com o formulário.
- `Development.signalRatio`, `balloonRatio` e `balloonIntervalMonths` continuam na tabela para o motor do MVP; a remoção é da Fase 12, quando a conversa deixar de usar `simulate()` com obra.
- `parameters.test.ts` ("alteração concorrente") falhou uma vez numa execução completa em paralelo e passou nas três execuções isoladas e na repetição da suíte; parece sensível a carga, não a esta fase.
- Os testes do banco precisam de PostgreSQL: usei `postgres:17-alpine` em Docker com `TEST_DATABASE_URL`.
- Os números das condições e os preços do seed são inventados até o financeiro validar.
