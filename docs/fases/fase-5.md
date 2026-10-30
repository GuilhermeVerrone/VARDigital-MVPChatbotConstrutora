STATUS: PARCIAL

# Fase 5 — Orquestrador e fluxo de coleta

**Resumo:** a máquina de estados do spec §5 (saudação → consentimento LGPD → identificação → interesse → perfil → co-proponente → entrada/FGTS → elegibilidade → confirmação) está implementada, persistida por etapa e ligada ao bot no lugar do eco. Passou em testes automatizados contra Postgres real (`pnpm check`: lint, typecheck e **305 testes**). **Não** foi testada com WhatsApp real nem com a imagem Docker nem com o Ollama ao vivo dentro do bot; isso depende de você (ver "Como validar").

## O que foi feito

- **`@mvp/conversation`** (puro): estados, perguntas e mensagens como templates (o LLM não escreve nenhuma), uma pergunta por vez, eco do valor anotado, validações (renda > 0, idade 18–100, data não futura), `voltar`, `corrigir <item>` e menu de correção, oferta de corretor após 3 respostas não entendidas, FAQ/fora de escopo, injeção recusada, opt-out, pedido LGPD, handoff básico, "sair" (pausa).
- **Persistência** (`@mvp/db`): `loadChat`, `startConversation`, `saveTurn`, `saveSession`; migration `20261029180000_chat_sessions`. Cada etapa grava estado, contexto e histórico e atualiza lead/perfil numa transação (RF-11).
- **Orquestrador** (`apps/bot/src/orchestrator.ts`): carrega, aplica a etapa, **grava e só depois envia** (com "digitando…"); a fila de respostas (`outbox`) é gravada junto, então reentrega ou queda no envio não repete a etapa nem as respostas já enviadas.
- **Retomada:** mesma conversa após reinício do serviço; parada > 6 h volta com "Que bom te ver de novo"; parada > 7 dias (RF-08) expira e exige novo consentimento.
- **Config nova:** `CHAT_HASH_SECRET` (obrigatória; `init-env.sh` gera), `LLM_MODEL` (padrão `llama3.2:3b`), `LLM_ENABLED`, `PROMPTS_DIR`, retenção e intervalo de retomada. Dockerfile e compose ajustados (novos pacotes, `prompts/`).

## Decisões

1. **Nada pessoal antes do aceite.** Antes do consentimento só existe `chat_sessions` com HMAC-SHA256 da conversa + estado (`CONSENT_ASKED`/`OPTED_OUT`). Aceite cria Lead + Consent (versão `ilustrativo-1`) + Conversation e apaga a sessão; recusa apaga a sessão e não grava nada. Teste confirma que o telefone não aparece na tabela.
2. **Gravar antes de enviar** (entrega "pelo menos uma vez" tratada na Fase 3, decisão 4): a janela de duplicata é só uma queda entre o envio e a gravação do que sobrou no `outbox`.
3. **Correção/voltar por "ponto de retorno":** depois de corrigir, o fluxo segue a primeira pergunta ainda sem resposta e, não havendo, volta à pergunta de onde saiu (ou à confirmação). Corrigir algo que ainda não foi perguntado é recusado ("ainda não chegamos nessa pergunta").
4. **Confirmação dos valores-chave** (spec §5.1) por eco a cada etapa + resumo final; é a mitigação do risco de o LLM errar um valor (ver Fase 4).
5. **Handoff, opt-out e LGPD são o mínimo:** marcam lead/conversa, registram em `audit_logs` e silenciam o bot. Notificar corretor, histórico formatado e exclusão real são da Fase 7.
6. **Fora do fluxo do MVP:** prazo desejado e cidade (opcionais no spec) e FGTS do co-proponente.
7. Antes do consentimento, "falar com corretor" vira um pedido de consentimento (não há onde guardar o contato).
8. **Relatório de teste do vitest:** o projeto roda com `maxWorkers: 2` (`vitest.config.ts`) e o timeout do `db` subiu para 60 s. Com todos os núcleos, workers não iniciavam e testes que sobem prisma/tsx estouravam 20 s nesta máquina de 16 GB.

## Resultados dos testes

`pnpm check`: **305 passed (23 arquivos)**, log em `logs/fase-5-check.log`. Novos: 15 da máquina (`packages/conversation`), 15 de integração com Postgres real (`apps/bot/test/conversation.test.ts`), 20 dos parsers, 16 do LLM.

| Critério de aceite | Evidência |
|---|---|
| Recusa de LGPD encerra sem coletar dado | `conversation.test.ts`: após "não" as tabelas leads, consents, conversations, financial_profiles e chat_sessions têm 0 linhas; 3 respostas confusas também encerram sem dados |
| Nada de dado pessoal gravado antes do aceite | idem: após o cumprimento, 0 leads e `chat_sessions` sem o telefone (só hash) |
| Retomada após reinício do serviço | outro orquestrador sobre o mesmo banco continua na etapa seguinte |
| Persistência por etapa | nome/e-mail/nascimento já no banco antes do fim; ao confirmar, `financial_profiles` gravado |
| Reentrega e queda no envio | mesma mensagem 2× → etapa aplicada 1×, sem resposta duplicada; falha no `sendText` → etapa gravada e reentrega envia só o que faltou |
| Conversa completa em ≤ 5 min via WhatsApp real | **não verificado** |

## Não verificado

- **Conversa completa no WhatsApp real** (≤ 5 min) e formato de lista (texto numerado) em celular.
- **Imagem Docker** nova (pacotes novos, `prompts/`, ESM) e `docker compose up` com `CHAT_HASH_SECRET`.
- **LLM ao vivo dentro do bot:** testado só com cliente simulado; a bateria da Fase 4 exercitou o Ollama real fora do bot.
- Vários workers concorrentes; mensagens fora de ordem entre conversas diferentes.
- Fuso: "hoje" (idade, validação de datas) usa UTC.

## Riscos

- O lead pode ficar em `CORRECTION_MENU`/`HANDOFF_OFFER` sem uma saída óbvia além de responder; ainda falta teste com pessoas reais.
- `chat_sessions` guarda hash do telefone indefinidamente (retenção: Fase 7). Hash de telefone é pseudonimização, não anonimização.
- A mensagem inicial ainda fica em `processed_messages.payload` (texto e telefone) até o processamento, como na Fase 3; mensagens `DEAD` mantêm o payload.
- Texto de consentimento e avisos são **ilustrativos** até o jurídico aprovar (`CONSENT_TEXT_VERSION = ilustrativo-1`).
- Valores errados vindos do LLM (Fase 4) só são pegos se o lead reparar no eco ou no resumo.

## Como validar

1. `infra/scripts/init-env.sh` (gera `CHAT_HASH_SECRET`), `ollama pull llama3.2:3b`, `docker compose up --build`.
2. Do número liberado em `ALLOWED_PHONES`, mande "oi" e converse até "Prontinho, anotei tudo". Confira em `leads`, `consents`, `conversations`, `financial_profiles`.
3. Teste: recusar o consentimento, `voltar`, `corrigir renda`, `parar`, `falar com corretor`, derrubar o container no meio e continuar, uma resposta bem informal ("uns sete mil e pouco").
