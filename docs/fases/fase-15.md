STATUS: COMPLETA no escopo da fase (`pnpm check` verde: 795 testes na última execução). Verificado também no navegador (build de produção local, Postgres descartável): início, lista e detalhe do lead, PDF, simulador e bloqueio de publicação no editor. Não testado: WhatsApp real conectado (a tela de status foi testada com `fetch` simulado), deploy, Dockerfile/compose do painel (Fase 16).

# Fase 15 — Painel II: leads e fluxo do bot

**Resumo:** o painel ganha leads (lista, detalhe, atribuição, handoff, exclusão), o início com funil, o editor do fluxo do bot (rascunho → publicar → reverter, com linter), o simulador de conversa e o status do WhatsApp.

## O que foi feito

- **Leads** ([leads.ts](../../packages/db/src/panel/leads.ts), telas em `apps/painel/src/app/(app)/leads`): filtros por empreendimento, modo, parecer, status, corretor e origem, mais busca por nome, telefone ou ELV-xxxx. Detalhe com conversa, simulações e plano, PDF refeito da simulação gravada, consentimento (com o texto aceito) e histórico de status. Atribuir/trocar corretor, assumir/devolver o handoff e pedir a exclusão (digitar EXCLUIR).
- **Escopo do corretor:** todo acesso a lead passa pelo escopo (`leadScope`): o corretor só vê e mexe nos próprios leads; lead de outro corretor é "não encontrado" (lista, detalhe, PDF e ações). Corretor sem vínculo não vê nada. Corretor não atribui nem exclui.
- **Histórico de status:** antes não havia registro das mudanças. Agora cada mudança grava `status_changed` na auditoria (bot, entrega, painel). Leads antigos começam o histórico daqui.
- **Devolver o handoff pelo painel:** usa a mesma `resumeAfterHandoff` do bot e enfileira o job novo `OUTBOX_FLUSH`; o worker do bot envia a pergunta ao lead (teste de ponta a ponta no bot).
- **Início:** funil formulário → contato confirmado → simulação → corretor (cada etapa conta quem chegou nela), simulações por modo, leads do dia e conversas aguardando corretor. Respeita o escopo.
- **Fluxo do bot** ([flow-lint.ts](../../packages/conversation/src/flow-lint.ts), `apps/painel/.../fluxo`): editor por texto (variáveis permitidas por texto, padrão do código como placeholder), 1ª mensagem editável, liga/desliga das 5 etapas opcionais, botões por etapa, blocos legais travados (mostrados, não editáveis). Rascunho único; publicar exige motivo e audita; reverter cria uma versão nova com o conteúdo da anterior.
- **Linter:** variável que o bot não preenche, chaves sem par, variável obrigatória removida, palavra proibida (aprovado, garantido, sem juros, lucro…), texto vazio/longo, chave desconhecida, botões (máx. 3 de 25). Roda ao salvar (mostra) e ao publicar (bloqueia, no servidor). Pergunta de sim/não sem instrução vira só aviso.
- **Simulador** ([simulator.ts](../../apps/painel/src/lib/simulator.ts)): roda `interpretStep` → `applyInterpretation` → `enterResult` e o mesmo `computePaymentSimulation`, sem gravar nada e sem LLM. Roda o rascunho ou a publicada, pelo WhatsApp ou pelo formulário; mostra estado e dados coletados ao lado. O resultado mostrado é o texto real do bot.
- **WhatsApp:** `GET /api/sessions/{id}` do WA-AKG (chave só no servidor, erro sem detalhe).
- **Papéis:** ADMIN e GERENTE tudo (financiamento só admin); CORRETOR: início, seus leads, assumir/devolver. Novas permissões `leads:*`, `flow:*`, `simulator:use`, `whatsapp:read`.

## Aceite

| Critério | Resultado |
|---|---|
| Editar e publicar um texto muda a próxima mensagem do bot | Passa (`leads-flow.test.ts`: o texto publicado aparece na conversa do simulador, que usa o mesmo caminho do bot). O bot lê o fluxo com cache de até 60 s. |
| Reverter volta à versão anterior | Passa (teste e `panel-flow.test.ts`). |
| Variável inválida ou palavra proibida não publica | Passa (publicação recusada, nada vai ao ar; testado também na tela). |
| O simulador percorre os 3 modos | Passa (`simulator.test.ts`, do início ao resultado, mais pelo formulário e o "não" do double opt-in). |
| Corretor vê só os próprios leads | Passa (db e serviços; lista, detalhe e ações). |

## Decisões

1. **Exclusão imediata, com confirmação:** "pedir a exclusão" executa `eraseLead` (motivo `titular`) após digitar EXCLUIR, com o usuário na auditoria; abre a pendência de limpeza do WA-AKG. Só ADMIN e GERENTE.
2. **Rascunho salvo mesmo com erro:** é trabalho em andamento; o que o linter reprova só impede publicar.
3. **Botões guardados, não enviados:** a Fase 9 decidiu manter lista numerada; o editor grava os rótulos e avisa isso na tela.
4. **Parecer do lead = `scoreClass`** (1:1 com o parecer da última simulação), o que permite filtrar pela simulação mais recente.
5. **Moveu-se `view.ts`** do bot para `@mvp/db` (`toView`/`toPaymentView`) para o painel gerar o mesmo PDF.

## Pendências

- Dockerfile/serviço do painel no compose, revisão de segurança e CSP (Fase 16).
- Gestão de usuários do painel (herdada da Fase 14); só assume o handoff quem tem corretor vinculado.
- Linter sem teste jurídico: a lista de palavras proibidas é um ponto de partida para o time revisar.
- Simulador sem LLM: respostas em texto livre que só o LLM entenderia não são testadas ali.
- Teste de desempenho de `packages/simulation` oscilou em 2 de 3 execuções completas por carga da máquina (passa isolado; o pacote não foi alterado).
- Variáveis novas no painel: `WA_AKG_BASE_URL`, `WA_AKG_API_KEY`, `WA_AKG_SESSION_ID` (em `infra/.env.example`).

## Testes

Novos: `lead-status`, `panel-leads` (10), `panel-flow` (6), `flow-lint` (9), `leads-flow` (9), `simulator` (7), `whatsapp` (4), `phase15` do bot (2), permissões (+2). De 741 para 795.
