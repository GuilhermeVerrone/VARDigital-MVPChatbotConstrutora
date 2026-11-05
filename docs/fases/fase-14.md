STATUS: COMPLETA no escopo da fase (`pnpm check` verde: 741 testes). Verificado também no navegador (build de produção local, Postgres descartável): login, prévia, publicação e auditoria. Não testado: deploy real, Dockerfile/compose do painel (Fase 16).

# Fase 14 — Painel I: base, cadastros e motor

**Resumo:** `apps/painel` (Next.js) com login, sessão, papéis, cadastros de empreendimentos/unidades/corretores, condições comerciais versionadas com calculadora de prévia, financiamento simulado e auditoria filtrável.

## O que foi feito

- **Dados** ([packages/db/src/panel](../../packages/db/src/panel), entrada `@mvp/db/panel`): empreendimentos e unidades (CRUD, status, "publicar no site"), corretores, financiamento (nova `ParameterSet`), prévia e lista de auditoria. Toda escrita grava auditoria com o id do usuário e só os campos que mudaram.
- **Prévia = bot:** o cálculo foi extraído de `runAndRecordPaymentSimulation` para `computePaymentSimulation`, usado pelo bot e pela prévia. Teste compara o resultado do painel com a simulação gravada do bot, 3 modos × 3 perfis de exemplo.
- **Papéis** ([permissions.ts](../../apps/painel/src/lib/permissions.ts)): ADMIN tudo; GERENTE tudo menos alterar financiamento; CORRETOR só o início (leads na Fase 15). Barreiras: `proxy.ts` (sem cookie → login), `requirePage` em cada página, e cada serviço confere a permissão antes de tocar no banco. Caminho sem regra é negado.
- **Login:** argon2, sessão com hash do token, cookie httpOnly/SameSite=lax, bloqueio por conta (já existente) e limite por IP; login e logout vão para a auditoria.
- **Condições comerciais:** formulário em % com validação do schema do motor, calculadora ao lado (unidade + perfil de exemplo, usando o rascunho do formulário), diff contra a vigente, publicação com vigência e motivo, histórico e comparação entre duas versões.
- **Financiamento simulado:** edita taxa, prazo, sistemas, sistema padrão e comprometimento de uma linha; publica nova `ParameterSet`.

## Aceite

| Critério | Resultado |
|---|---|
| Rotas protegidas por papel (testes) | Passa: matriz rota × papel, serviços recusam CORRETOR e financiamento do GERENTE, nada é gravado nas recusas. |
| Alterar condição muda a próxima simulação do bot sem deploy | Passa (teste de serviço e teste manual no navegador). |
| Prévia bate exatamente com o bot | Passa (`toEqual` no resultado completo). |
| Toda alteração na auditoria com o usuário | Passa: empreendimento, unidade, corretor, condição, financiamento, login/logout. |

## Decisões

1. **Sem shadcn/Tailwind:** o painel usa CSS próprio sobre os tokens de `@mvp/ui`, como o site; evita dependências e CLI nesta fase.
2. **Rascunho = o formulário.** Não há tabela de rascunho (sem migration; `migrate diff` segue vazio). O rascunho vive no formulário, com prévia e diff antes de publicar. Rascunho salvo entre sessões exigiria migration.
3. **Perfis de exemplo fixos** (3) na prévia; não são leads.
4. **Corretor ↔ usuário:** o painel não cria usuários nesta fase (só o admin de demo do seed); gestão de usuários fica para depois.
5. **Rate limit de login em memória** (instância única).

## Pendências

- Dockerfile/serviço do painel no compose (Fase 16).
- Gestão de usuários do painel.
- Favicon e revisão de segurança (`/security-review`, Fase 16).
- Variáveis: `PANEL_DATABASE_URL` etc. em `infra/.env.example`. Rodar: `pnpm --filter @mvp/painel build && pnpm --filter @mvp/painel start` (porta 3300).

## Testes

Novos: `panel` (db, 12), `permissions` (14), `condition-form` (6), `services` (8) — de 706 para 741.
