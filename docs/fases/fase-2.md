STATUS: PASS

# Fase 2 — Dados e parâmetros

## O que foi feito

Pacote `packages/db` (`@mvp/db`): schema Prisma, migration, seed idempotente, repositório de parâmetros com vigência por data, CLI de alteração com auditoria e um serviço que roda o motor da Fase 1 com os parâmetros vigentes e grava a simulação.

- **Schema (11 entidades do plano):** Lead, Consent, Conversation, FinancialProfile, Development, Unit, Simulation, CreditLine, Broker, AuditLog, ProcessedMessage. Há ainda `ParameterSet`, a versão do conjunto de parâmetros, a que `CreditLine` pertence. O mapeamento spec → tabela está em `packages/db/README.md`.
- **Seed:** 1 empreendimento, unidades, 3 linhas de crédito e 2 corretores, todos `ILUSTRATIVO`. Rodar de novo não duplica nada e não sobrescreve parâmetros já alterados pela CLI.
- **Parâmetros com vigência:** cada versão vale em `[validFrom, validTo]`. Publicar a partir de F encerra a versão anterior em F−1. Vigência retroativa exige `--allow-retroactive`. Publicar antes de uma versão futura já agendada é recusado.
- **CLI** (`pnpm --filter @mvp/db params show|history|set|import`): `--dry-run`, `--by`, `--reason`. Códigos de saída: 0 ok, 1 regra violada (nada gravado), 2 uso incorreto.
- **Auditoria (RF-52):** toda alteração grava quem, quando, motivo, antes e depois. Validar a tabela com o financeiro (`status=VALIDADO`) também é uma alteração auditada.
- **Simulação:** `runSimulation` lê a versão vigente na data, chama o motor e grava `parametersVersion` (= `parametros_versao`), mais a FK da versão e da linha de crédito.

## Arquivos principais

- `packages/db/prisma/schema.prisma`, `prisma/migrations/20261027031117_init/migration.sql`
- `packages/db/src/parameters/repository.ts` e `changes.ts` (vigência, alteração, auditoria)
- `packages/db/src/simulation-service.ts`, `src/seed.ts`, `src/cli/params-cli.ts`
- `packages/db/test/*.test.ts`, `test/global-setup.ts` (banco de teste real)
- `infra/scripts/db-setup.sh` (migrations + seed + `params show` no Postgres do compose)

## Decisões

1. **Garantias no próprio banco (SQL à mão na migration).** Não bastava confiar na aplicação:
   - `parameter_sets_no_overlap`: restrição de exclusão por `daterange`, nunca há duas versões ativas na mesma data.
   - `parameter_sets_guard`: a versão é imutável (só `valid_to` e `superseded_by_id` mudam; não se apaga).
   - `credit_lines` e `audit_logs` são somente inserção (trigger bloqueia UPDATE e DELETE).
   - O Prisma não modela essas peças, mas não tenta removê-las: `migrate diff` continua vazio, e há teste para isso.
2. **Linha de crédito pertence a uma versão.** A vigência da linha é a da versão, então uma alteração de taxa gera um conjunto novo e completo, e o histórico fica consultável.
3. **Valor que não cabe na precisão da coluna é recusado**, não arredondado em silêncio (ex.: taxa com 9 casas).
4. **`actor` da auditoria é texto**, porque o MVP não tem tabela de usuários.
5. **Co-proponente fica no `FinancialProfile`** (tipo de renda, dívidas, FGTS), porque o motor precisa desses campos.
6. **`DistribuicaoLead` e `ResultadoContato` ficam de fora**: são pós-MVP (spec §10).
7. **Client Prisma gerado não é versionado** (`packages/db/src/generated/` no `.gitignore`); é gerado no `postinstall`.
8. **Opção `rejectIllustrative`** no serviço de simulação: recusa simular com parâmetros não validados pelo financeiro. Isso atende a sugestão do relatório da Fase 1 de bloquear `ILUSTRATIVO` em produção. Ligar essa opção no bot é trabalho da Fase 5/6.

## Resultado dos testes

Banco de teste real: `global-setup.ts` usa `TEST_DATABASE_URL` ou sobe um cluster descartável com `initdb`/`pg_ctl` (Homebrew aqui). Se não houver nenhum, falha, não pula.

`pnpm check` (lint + typecheck + testes) passou sem erros:

```
Test Files  11 passed (11)
     Tests  163 passed (163)
```

São 130 testes das fases anteriores e 33 novos em `packages/db`. Critérios de aceite do plano:

| Aceite | Teste |
|---|---|
| Simulação lê parâmetros vigentes na data | `vigência por data` (4 testes: F−1 vs F, versões encadeadas, sem tabela vigente → erro) e `lê a versão vigente NA DATA da simulação ... antes e depois de uma alteração via CLI` |
| Alteração via CLI gera histórico | `cli.test.ts > set cria nova versão, ajusta a vigência e grava histórico consultável`; `auditoria (RF-52)` |
| Simulação grava `parametros_versao` | `o que foi gravado é exatamente o que o motor puro calcula com a versão vigente` |

Também cobertos: ida e volta banco ⇄ motor idêntica, sem drift entre migration e `schema.prisma`, telefone único (RF-41), idempotência por `key.id`, alterações concorrentes na mesma data (uma vence, a outra falha), seed idempotente e CLI real via `tsx`.

## Não verificado

- **Postgres do compose (`bot-db`) e `infra/scripts/db-setup.sh`**: o daemon do Docker estava parado nesta máquina. O script não foi executado. As mesmas migrations rodam nos testes num Postgres real local, mas não no container. Para validar: `docker compose up -d bot-db && ./infra/scripts/db-setup.sh`.
- **Sensibilidade dos testes**: nesta fase não repeti o teste de mutação da Fase 1 (quebrar o código de propósito e ver os testes falharem).
- **Dados reais**: parâmetros e catálogo são `ILUSTRATIVO`. Não houve conferência com o financeiro.
- **Versão do PostgreSQL**: os testes rodam no Postgres do Homebrew local; o compose usa `postgres:16-alpine`. A restrição de exclusão usa só `daterange` com `gist` (sem `btree_gist`), recurso nativo, mas não foi exercitada na imagem 16-alpine.

## Riscos

- Um conjunto `ILUSTRATIVO` sem `rejectIllustrative` dá simulação com aviso, mas com números inventados. Ligar a opção antes de qualquer lead real.
- A CLI é o único caminho de alteração e não tem autenticação: `--by` é texto livre. Aceitável no MVP (acesso restrito ao servidor); o painel com RBAC é Fase 2 do spec / pós-MVP.
- A imutabilidade vale para o papel comum da aplicação; um superusuário do banco ainda pode desativar os triggers.
- Os dois commits da fase (`5fc6931`, `ec9705e`) foram feitos antes do relatório; o estado final está verde.
