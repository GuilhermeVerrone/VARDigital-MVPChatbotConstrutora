# V2 · 07 — Plano do onboarding do cliente (Fase 18)

Objetivo: entregar à construtora um guia de onboarding completo, cobrindo todas as funcionalidades, com um roteiro de testes passo a passo e prints. Decisões aprovadas pelo usuário em 2026-11-07:

- **Formato:** Markdown no repositório (`docs/onboarding/`) como fonte, mais um PDF exportado para entregar ao cliente.
- **Lacunas do produto entram na fase:** tela de usuários e troca de senha (sem elas o onboarding não cobre o corretor).
- **Prints gerados por script** (Playwright sobre a stack do e2e), reproduzíveis; prints reais do celular só no ensaio publicado.

## Lacunas que o onboarding expõe

1. Não há tela de usuários (pendente desde a Fase 14): não dá para criar corretor ou gerente pelo painel.
2. Não há troca de senha; a senha do admin do seed é pública no repositório.
3. A demo nunca foi ensaiada no ambiente publicado (prints reais do WhatsApp dependem disso).
4. Limitações a declarar: sem botões de resposta rápida (Fase 9), dados `ILUSTRATIVO`, tom das mensagens em aberto (`ajustes.txt` item 4).

## Estrutura do guia

| # | Seção | Público |
|---|---|---|
| 1 | Visão geral: o que o produto faz, jornada site → WhatsApp → corretor → painel, glossário | Todos |
| 2 | Primeiro acesso: login, troca de senha, papéis | Todos |
| 3 | Jornada do comprador: site, formulário, 1º contato, 3 modos, resultado, PDF | Gestor, marketing |
| 4 | Guia do Admin/Gerente: empreendimentos, condições, financiamento, corretores, usuários, fluxo, simulador, WhatsApp, auditoria | Admin, gerente |
| 5 | Guia do Corretor: meus leads, detalhe, PDF, assumir/devolver atendimento | Corretor |
| 6 | Privacidade (LGPD): consentimento, double opt-in, exclusão, retenção | Gestor, jurídico |
| 7 | Roteiro de testes com prints | Quem homologa |
| 8 | Problemas comuns | Operação |
| 9 | Limitações conhecidas e checklist de go-live | Gestor |

## Roteiro de testes

Cada caso tem pré-condição, passos, resultado esperado e print.

- **Site:** T01 home com preços do banco · T02 página do empreendimento · T03 formulário (consentimento obrigatório, telefone inválido) · T04 obrigado com `ELV-xxxx` · T05 reenvio não duplica · T06 privacidade.
- **WhatsApp:** T07 1º contato + "sim" · T08 "não" encerra · T09 início pelo WhatsApp · T10–T12 os 3 modos · T13 correção de dado · T14 ajuste de entrada/prazo · T15 pedir corretor · T16 pedir exclusão · T17 card e PDF do corretor.
- **Painel:** T18 login e bloqueio · T19 início/funil · T20 filtros de leads · T21 detalhe e PDF · T22 atribuir corretor · T23 assumir/devolver handoff · T24 exclusão · T25 empreendimentos e unidades · T26 condições (rascunho, prévia, publicar, diff) · T27 próxima simulação muda · T28 financiamento · T29 corretores · T30 usuários · T31 fluxo do bot · T32 simulador · T33 status do WhatsApp · T34 auditoria · T35 papéis.

## Prints

- **Automático:** `e2e/onboarding/shots.spec.ts` sobe a stack do e2e, percorre os casos e salva em `docs/onboarding/img/Txx-*.png`. Data e seed fixos, desktop para o painel, desktop e mobile para o site, marcadores numerados injetados por CSS. Comando: `pnpm docs:shots`.
- **WhatsApp no automático:** página neutra de transcrição (balões genéricos, sem a marca do WhatsApp) a partir do que o WA-AKG falso registrou.
- **Manual:** checklist de prints reais no celular (T07, T10–T12, T15, T17) no ambiente publicado.

## Partes (um commit cada, branch `v2/fase-18-onboarding`)

1. Tela de usuários no painel (criar, desativar, papel, vínculo com corretor, auditoria, testes de permissão).
2. Troca de senha ("Minha conta") e aviso de senha do seed.
3. Página de transcrição do WhatsApp falso.
4. Script de prints e `pnpm docs:shots`.
5. `docs/onboarding/` com as seções 1–9 e os prints.
6. Exportação do guia para PDF.
7. Ensaio no ambiente publicado, prints reais e `docs/fases/fase-18.md`.

**Aceite:** `pnpm check` e `pnpm test:e2e` verdes; `pnpm docs:shots` gera todos os prints; todo caso T01–T35 com passos, resultado esperado e print; uma pessoa de fora homologa só com o guia.

**Depende de:** a parte 7 exige o deploy e o número dedicado conectado. As partes 1–6 rodam localmente.
