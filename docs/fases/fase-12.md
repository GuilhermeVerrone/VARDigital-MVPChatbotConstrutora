STATUS: PARCIAL. Código e testes feitos (`pnpm check` verde). **Não foi testado no WhatsApp real** (sem aparelho e sem o formulário do site, que é a Fase 13), e os casos novos da bateria do `extraction.v3` **não foram rodados na Anthropic** (sem chave no ambiente).

# Fase 12 — Conversa v2

**Resumo:** o bot passa a conversar pelas três formas de pagamento (à vista, entrada de uma vez com financiamento do saldo, entrada parcelada com a construtora), a escolher o empreendimento, a começar pelo formulário do site com *double opt-in* e a ler os textos e as etapas opcionais do `FlowConfig` publicado. Resultado, PDF, dossiê do corretor e CRM mostram o modo e o plano da entrada.

## O que foi feito

### Conversa ([packages/conversation](../../packages/conversation))

- **Estados novos**: `CONTACT_CONFIRM` (formulário), `DEVELOPMENT` (WhatsApp), `PAYMENT_MODE`, `DOWN_CASH` (modo 2), `CASH_NOW`, `DESIRED_INSTALLMENT` e `BALLOONS` (modo 3), `CASH_OFFER` (modo 1) e os ajustes `ADJUST_ACT`, `ADJUST_BALLOONS` e `ADJUST_UNIT`.
- **Ramos**:
  - À vista: forma de pagamento → confirmação → resultado → oferta do corretor (`CASH_OFFER`).
  - Entrada de uma vez: valor da entrada → (perfil e FGTS, só se a estimativa do banco da condição estiver ligada) → confirmação.
  - Entrada parcelada: renda, tipo, dívidas, co-proponente → ato → parcela desejada → reforços (só se a condição os oferece) → confirmação.
- **Menu de resultado por modo** (`resultOptions`): mudar o ato ou a entrada, aceitar ou recusar reforços, outra unidade, outra forma de pagamento, PDF, corretor e "está ótimo". "Outra forma de pagamento" reaproveita o mecanismo de correção: refaz só o que a nova forma pede e volta à confirmação.
- **Menu de correção** mostra só os itens do caminho do lead.
- **Textos do FlowConfig** ([texts.ts](../../packages/conversation/src/texts.ts)): cada pergunta tem uma chave (`ASK_NAME`, `ASK_BALLOONS`...), um padrão no código e variáveis (`{nome}`, `{empreendimento}`, `{telefone}`, `{intervalo}`). O texto publicado sobrepõe o padrão chave a chave; sem versão publicada ou sem a chave, vale `templates.ts`. `textVariables()` e `KNOWN_VARIABLES` ficam prontos para o validador do editor (Fase 15). Os textos legais (consentimento, aviso da simulação, exclusão) **não** são editáveis por aqui.
- **Etapas opcionais** respeitam `optionalSteps`: `EMAIL`, `CO_ASK`, `BIRTH`, `DESIRED_INSTALLMENT`, `BALLOONS`. Desligar `BIRTH` desliga também a estimativa do banco (ela precisa do nascimento).
- **Início pelo formulário**: `formSnapshot()` abre em `CONTACT_CONFIRM` com nome, telefone, e-mail e empreendimento já no contexto. "Sim" segue para a primeira pergunta que falta; "não" (ou 3 respostas sem sentido) encerra com `OPTED_OUT` e `CLOSED`, responde uma vez e não escreve mais. "Parar", "apagar meus dados" e "corretor" valem desde o primeiro estado.
- **Tom das mensagens** (ajustes.txt item 4, Prompt Guide Parte C), revisado:
  - a confirmação antes de cada pergunta varia ("Anotado", "Perfeito", "Beleza"...), de forma determinística para o mesmo texto;
  - "Prazer, Maria!" no lugar de "Certo, prazer, Maria";
  - perguntas de dívidas e de parcela reescritas (ajustes.txt item 2): "Hoje você paga alguma parcela todo mês...?" e "Quanto da sua renda por mês você se sente à vontade para destinar à parcela...?";
  - o "não" seco já era aceito nas perguntas de valor (item 3, resolvido na Fase 8) e continua nos novos `DOWN_CASH`, `CASH_NOW` e `DESIRED_INSTALLMENT`;
  - resultados em listas com no máximo um emoji por mensagem (testado);
  - o texto numerado fica no rodapé da lista, como pede a Parte C.

### Apresentação ([packages/presentation](../../packages/presentation))

`PaymentView`, `paymentResultMessages`, `paymentDossierCard` e `buildPaymentPdf`: o modo, o plano da entrada (ato, mensais, reforços, chaves, juros, projeção da correção), a capacidade de pagamento e a estimativa do banco quando existe. O aviso legal da forma de pagamento fala de condição comercial e confirmação da construtora, não só de crédito. Nenhum texto passa por LLM.

### Banco ([packages/db](../../packages/db))

- Migration aditiva `20261106120000_lead_contact_code`: `leads.contact_code` (único), o código `ELV-4821` do formulário.
- [form-leads.ts](../../packages/db/src/form-leads.ts): `assignContactCode`, `extractContactCode`, `findFormLead` (por endereço, telefone ou código; só quem veio do site, tem consentimento WEB válido e ainda não tem conversa), `startFormConversation` (idempotente) e `closeUnconfirmedFormLeads` (48 h).
- `listDevelopmentCatalog` (empreendimentos ativos, tipologias e o que a condição vigente oferece), `pickUnitForTypology` por empreendimento, `SimulationBundle.payment`, `FinancialProfile.cashNow/acceptsBalloons` e `lead.developmentId/paymentMode/contactConfirmedAt` gravados pelo turno.
- `skipBankEstimate` nas escolhas da simulação (etapa de nascimento desligada no painel).

### Bot ([apps/bot](../../apps/bot))

- O ambiente da conversa (`FlowEnv`) agora traz os empreendimentos com as regras da condição vigente e o fluxo publicado (cache de 60 s, como o resto).
- `finishSimulation` roda `runAndRecordPaymentSimulation` quando o empreendimento tem condição vigente: grava modo, plano, versão da condição e (se houve estimativa) dos parâmetros.
- **Casamento do lead**: mensagem de quem preencheu o formulário abre a conversa em `CONTACT_CONFIRM` (telefone ou endereço já gravado). Resposta vinda de um `@lid` casa pelo código `ELV-xxxx` no texto e, como o lead escreveu primeiro, já vale como confirmação.
- A retenção passou a encerrar, a cada passada, os leads do formulário sem confirmação há mais de 48 h.
- Entregas: dossiê, PDF e resumo do CRM com o modo e o plano.

## Decisões

1. **`sendButtons` não foi implementado.** A decisão da Fase 9 (confirmada pelo usuário em 04/11/2026) é manter o texto numerado: a mensagem interativa não chegou no aparelho testado. Reabrir só se isso mudar.
2. **Empreendimento sem condição vigente segue o fluxo de financiamento do MVP** (renda, entrada, parcela, FGTS...). É o que mantém os testes e o seed do MVP funcionando e evita um bot mudo se uma condição expirar. Em produção, os três Elevare têm condição.
3. **O 1º contato (FIRST_CONTACT) é da Fase 13**: o worker de entrega ainda recusa esse tipo. Aqui ficaram o texto ([firstContactText](../../packages/conversation/src/texts.ts), com a chave `FIRST_CONTACT` e o campo `firstContact` do FlowConfig) e a abertura da conversa. A conversa nasce quando o lead responde (ou escreve com o código); não é preciso o worker criá-la.
4. **A tipologia do formulário**: o `Lead` não guarda tipologia, então o bot a pergunta (`INTEREST`) depois do "sim". Se a Fase 13 quiser pular essa pergunta, basta gravar a tipologia no contexto da conversa (`formSnapshot` já aceita `typology`).
5. **E-mail ausente no formulário vale "pulou"**: não é perguntado de novo.
6. **Pagamento à vista e entrada de uma vez sem estimativa do banco não criam perfil financeiro** (renda é obrigatória na tabela); o dinheiro disponível vai direto ao motor. O ajuste do ato nesses modos não aparece como "cenário" no PDF refeito, porque não há perfil para comparar.
7. **Nada de número inventado**: os textos novos só repetem valores do motor (testado com `unexplainedNumbers` nas mensagens e no dossiê dos três modos).

## Testes

`pnpm check` verde: lint, typecheck e 664 testes (eram 596).

| Arquivo | O que cobre |
|---|---|
| `packages/conversation/test/payment-flow.test.ts` | 3 ramos, etapas desligadas, FlowConfig com fallback, formulário (sim, não, indeciso, parar, corretor), menu por modo, ajustes, correção, troca de empreendimento e exclusão/parada/corretor em todos os estados novos |
| `packages/presentation/test/payment.test.ts` | mensagens, dossiê e PDF dos 3 modos; todo número vem do motor; um emoji por mensagem; PDF reproduzível |
| `packages/db/test/form-leads.test.ts` | código, casamento do lead, conversa idempotente e fechamento em 48 h |
| `apps/bot/test/phase12.test.ts` | ponta a ponta com Postgres real e os 3 empreendimentos Elevare: 3 modos, ajustes, entrega ao corretor (dossiê com o plano e PDF) e ao CRM, FlowConfig publicado, formulário (sim, não, `@lid` com código, consentimento do chat para quem não veio do site), exclusão e corretor |

Aceite da fase:

| Critério | Situação |
|---|---|
| Máquina de estados dos 3 modos ponta a ponta, com canal falso | **Feito** (`phase12.test.ts`) |
| "Não" no `CONTACT_CONFIRM` encerra e não envia mais nada | **Feito** |
| Lead do formulário não recebe consentimento, nome nem telefone | **Feito** |
| Todo número nas mensagens vem do motor | **Feito** (teste novo; o do MVP segue valendo) |
| Handoff e exclusão valem nos estados novos | **Feito** |
| Suíte do `extraction.v3` estendida | **Feito**, mas **não rodada** (14 casos novos: `p15` a `p28`) |

## Pendente

- Rodar a bateria na Anthropic (comando da Fase 11b) e registrar o acerto dos casos `p15` a `p28`.
- Testar o fluxo do formulário no WhatsApp real depois da Fase 13 (1º contato → "sim" → perguntas; e a resposta vinda de `@lid`).
- Revisar com o jurídico/financeiro os textos novos de pergunta e o aviso legal da forma de pagamento (`RASCUNHO`).
- Validar com o financeiro as regras do modo 3 (condição `ILUSTRATIVO`).
- Fase 15: o editor precisa validar as variáveis dos textos com `textVariables()` e bloquear as palavras proibidas.
