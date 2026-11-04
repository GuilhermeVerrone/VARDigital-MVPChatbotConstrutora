STATUS: PASS (testes automatizados) — o piloto com WhatsApp real ainda não foi feito

# Fase 8 — Endurecimento e piloto

**Resumo:** roteiros de leads de ponta a ponta (viável, com ajustes, inviável, informal, injeção de prompt, áudio/imagem), um registro de log estruturado por turno de conversa, limites de entrada (mensagens por minuto por conversa e tamanho do texto), o runbook do piloto e o checklist do spec §13 abaixo. `pnpm check`: lint, typecheck e **471 testes** passando (contra Postgres real).

## O que foi feito

- **Roteiros de ponta a ponta** (`apps/bot/test/phase8.test.ts`, Postgres real; só o WhatsApp é simulado):
  - *viável*: coleta completa, resultado do motor, PDF e card ao corretor, um único contato no CRM;
  - *com ajustes* (entrada de R$ 58 mil): o bot explica o que falta, sem promessa de aprovação; o ajuste de entrada leva a "viável";
  - *inviável* (renda R$ 1.500, entrada R$ 5 mil): sem promessa, lead frio, o corretor ainda recebe;
  - *informal* ("uns 7k", "trabalho por conta própria", "5 de março de 1990", "nenhuma"): chega aos mesmos dados;
  - *injeção de prompt*: com um LLM comprometido que devolveria renda de R$ 99.999.999, a heurística barra antes de consultá-lo (0 chamadas), nada é gravado e uma resposta normal depois é aceita;
  - *áudio e imagem*: o bot pede texto, não avança e não grava nada.
- **Log estruturado por conversa.** Um registro `turno da conversa` por mensagem (`conversationId`, `leadId`, `messageId`, tipo, estado anterior → novo, nº de respostas e de entregas, handoff), `simulação concluída` e `mensagem processada` com `durationMs`. Só ids e estados; nenhum conteúdo, telefone ou valor.
- **Limites de entrada.** `RATE_LIMIT_PER_MIN` (30 por conversa; 0 desliga): o excedente é descartado no webhook com aviso no log. `MAX_TEXT_CHARS` (2000): texto maior é cortado antes de entrar na fila. O worker já processava uma mensagem por vez (ordem garantida e LLM local sem concorrência).
- **Runbook** em [`docs/05-runbook.md`](../05-runbook.md): checklist de abertura, o que olhar no dia a dia, situações comuns (bot mudo, mensagem perdida, `DEAD`, corretor sem card, LLM travado, mudança de taxas, exclusão, bloqueio do número), parar/subir, backup e atualização.

## Decisões

1. **Excesso de mensagens é descartado, não enfileirado.** O WA-AKG não reenvia, então a mensagem perdida é a de quem está em rajada; para o lead normal o limite (30/min) nunca é atingido.
2. **Sem concorrência no worker.** Com o LLM local, paralelizar só aumentaria a latência. Para o volume do piloto, uma mensagem por vez basta; o limite real é o tempo do modelo.
3. **Os 5 minutos de conversa são do lead digitando.** O teste automatizado prova que as 18 mensagens são todas respondidas e processadas em segundos; o tempo total depende de quem escreve.

## Checklist de aceite do MVP (spec §13)

| Critério | Estado | Evidência / observação |
|---|---|---|
| Lead conclui a simulação em até 5 min, sem intervenção | **Parcial** | Roteiro *viável*: 18 mensagens, todas respondidas, processamento em segundos. Falta medir com pessoa real no WhatsApp |
| Consentimento LGPD antes da coleta de dados pessoais | **OK** | Fase 5: nada de dado pessoal gravado antes do aceite (só hash da conversa); recusa encerra sem coletar |
| SAC/Price conferem com a planilha de referência do financeiro | **Pendente** | Os casos de referência são calculados à parte e conferem (Fase 1), mas **a planilha do financeiro ainda não existe**; parâmetros são ILUSTRATIVOS |
| Parecer coerente com as regras parametrizadas | **OK (com os parâmetros ilustrativos)** | Roteiros viável / com ajustes / inviável |
| Corretor recebe dossiê e PDF em até 1 minuto | **OK em teste** | Fase 6 e 7 medem < 1 min com o canal simulado. Falta o WhatsApp real |
| Lead no CRM sem duplicidade e com simulação anexada | **OK (CRM simulado)** | Fase 6; o CRM real é pós-MVP |
| Handoff em qualquer etapa e preserva histórico | **OK em teste** | Fase 7: 24 estados de pergunta + resultado, ajustes e finalizado |
| Financeiro altera taxas e faixas **no painel**, com histórico | **Parcial** | Por **CLI** com vigência e auditoria (Fase 2). O painel é da Fase 2 do spec (§14), fora do MVP |
| Bot nunca informa valores que não venham do motor ou da base | **OK em teste** | Fase 6: teste compara cada número da mensagem com a simulação, mesmo com LLM que inventa; Fase 8: injeção não altera nada |
| Painel exibe métricas básicas do funil | **Não feito** | Painel é pós-MVP (§14). Hoje: consultas SQL e logs por turno |
| Exclusão de dados do titular | **OK em teste** | Fase 7. O histórico no WA-AKG é limpo pelo script `wa-akg-erase.sh` (só o SQL foi validado) |

## O que falta para produção

- **API oficial do WhatsApp** (`CloudApiAdapter`) e templates: o WA-AKG é não oficial, com risco alto de bloqueio, e não tem retry de webhook nem endpoint de exclusão.
- **Textos jurídicos:** consentimento (hoje ilustrativo, sem fluxo de novo aceite quando a versão mudar), aviso legal da simulação, prazo de retenção (180 dias é um palpite) e política de privacidade.
- **Validação do financeiro:** parâmetros reais (taxas, linhas, seguros, limites de idade e cota), fluxo de obra do empreendimento e a planilha de referência para conferir SAC/Price.
- **Corretores e números reais** no banco e em `ALLOWED_PHONES`; os do seed são fictícios.
- **Painel** de parâmetros e de métricas; **CRM real** (com método de exclusão no `CrmAdapter`); distribuição com SLA e reatribuição; follow-up.
- **Tratamento de expediente** (spec §9): hoje o aviso ao corretor sai em qualquer horário.
- **Mídia:** áudio (transcrição) fica para depois; hoje o bot pede texto.
- **Operação:** HTTPS com domínio e certificado válidos (hoje CA de desenvolvimento), backup automático, alerta para fila `DEAD`/entrega `DEAD` e para sessão do WhatsApp caída, métricas além dos logs.
- **Segurança de dados:** criptografia em repouso, RBAC e auditoria de acesso (spec §15).
- Limpeza de **mídia** no volume do WA-AKG e das mensagens no aparelho do número do piloto.

## Não verificado

- **Nada foi exercitado com o WhatsApp real nesta fase**, nem o piloto com número dedicado e leads com opt-in (critério de aceite da fase): o checklist está verde só nos itens que testes automatizados conseguem provar.
- O ajuste de qualidade das mensagens anotado em `ajustes.txt` (botões de resposta rápida em perguntas sim/não, texto da pergunta de parcela, "não" não entendido, tom menos robotizado) **não foi tratado** nesta fase; recomendo fazê-lo antes de abrir o piloto.
- Comportamento sob carga real (várias conversas simultâneas com o Ollama): só o limite por conversa foi testado.

## Como validar

1. `pnpm check` (471 testes).
2. Siga o "Antes de abrir o piloto" do [runbook](../05-runbook.md) com o número dedicado.
3. Rode os seis roteiros pelo WhatsApp (viável, com ajustes, inviável, informal, injeção, áudio) e confira os logs: `docker compose logs bot | grep "turno da conversa"` não deve mostrar telefone, nome nem valores.
4. Mande 40 mensagens em um minuto: a partir da 31ª o log mostra `limite de mensagens por conversa excedido`.
