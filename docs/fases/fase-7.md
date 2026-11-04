STATUS: PASS (testes automatizados) — falta a validação com WhatsApp real e a limpeza do WA-AKG ao vivo

# Fase 7 — Handoff humano e LGPD

**Resumo:** "falar com corretor" funciona em qualquer etapa (inclusive depois do resultado e depois de finalizar): o lead é avisado, o corretor recebe um card com o histórico e um código, e o bot fica calado. O corretor assume e devolve a conversa por comandos no WhatsApp. O lead pode pedir a exclusão dos dados (com confirmação): o bot apaga tudo do nosso lado, deixa um registro mínimo na auditoria e uma pendência para limpar o WA-AKG. Há retenção configurável, mascaramento de dados pessoais nos logs e consentimento com o texto exato aceito. `pnpm check`: lint, typecheck e **460 testes** passando (contra Postgres real).

## O que foi feito

- **Handoff em qualquer etapa.** "Quero falar com um corretor" (e variações) vale em todos os estados de pergunta (24 testados; só `PHONE`, que aparece apenas para quem chega sem telefone, ficou de fora), no menu de resultado, nos ajustes e depois de finalizar (`DONE`). Três respostas não entendidas continuam oferecendo o corretor. Antes do consentimento o bot pede o OK antes de guardar o contato (como na Fase 5).
- **Aviso ao corretor** (`HANDOFF_NOTIFY`, mesma fila de entregas da Fase 6, gravado na mesma transação do estado): nome, telefone, e-mail, interesse, se já houve simulação, **as últimas 14 mensagens** da conversa (lead e bot, cortadas em 300 caracteres) e o **código** do atendimento. Reenviado com espera se o WhatsApp falhar; a reentrega do mesmo pedido não duplica.
- **Bot silencioso.** Em `HANDOFF` o bot não responde nada ao lead. Continuam valendo só "parar de receber" e "apagar meus dados" (direitos do titular).
- **Corretor assume e devolve**, por mensagem ao número do bot (só quando o remetente é um corretor cadastrado e a mensagem é um comando; qualquer outra mensagem dele segue como conversa de lead):
  - `assumir <código>`: registra o corretor responsável, passa o lead para ele e confirma com o telefone do lead. Outro corretor não consegue assumir o mesmo atendimento.
  - `devolver <código>`: só quem assumiu. O bot volta à pergunta em que o lead estava (ou ao menu do resultado), avisa o lead, e um novo pedido gera um código novo.
  - `pendentes`: lista os atendimentos em aberto do corretor.
- **Exclusão do titular (RF-10).** "Apagar meus dados" pede confirmação ("Posso apagar tudo?"). Só o "sim" apaga; "não" (ou três respostas sem sentido) volta para onde estava sem apagar nada. Vale em qualquer estado, inclusive em handoff, depois de finalizar e depois de pedir para parar. Apaga: lead, consentimentos, conversas, perfil, simulações, entregas, **contato e simulações do CRM simulado**, a fila de entrada do chat e a sessão pré-consentimento. O corretor que já recebeu o resumo é avisado por mensagem para apagar a cópia dele.
- **Registro mínimo.** Fica uma linha em `audit_logs` (`erased_by_request` / `erased_by_retention`) com o id sorteado do lead, o motivo, a data, **só contagens** do que havia e as versões/datas de consentimento. Sem telefone, nome, e-mail nem valores.
- **WA-AKG.** O WA-AKG guarda as mensagens no MySQL dele e **não tem endpoint para apagá-las** (só "apagar para todos" de mensagem enviada, com limite de 7 minutos). Por isso a exclusão cria uma pendência (`erasure_tasks`, com o endereço do chat) e `infra/scripts/wa-akg-erase.sh` apaga mensagens, contato e etiquetas no MySQL e fecha a pendência (o endereço some da tabela).
- **Retenção configurável.** `LEAD_RETENTION_DAYS` (padrão 180; 0 desliga): a cada 6 h o bot apaga, pelo mesmo procedimento, leads sem nenhuma atividade (lead, conversa e simulação) desde o corte, sessões de consentimento não respondidas e linhas antigas da fila de entrada. Quem pediu para parar (`OPTED_OUT` antes do consentimento) continua registrado para o silêncio.
- **Consentimento versionado.** Além da versão, o aceite grava o **texto exato** mostrado (`consents.text_snapshot`); "parar de receber" **revoga** o consentimento (`revoked_at`) sem apagá-lo.
- **Mascaramento nos logs.** Mensagens de erro (log, `last_error` da fila de entrada e de entregas) passam por `maskText`: JID/telefone ficam só com os 4 últimos dígitos, e-mail vira `***@dominio`, valores em R$ viram `R$ ***`, sequências longas de dígitos são mascaradas. O logger do Fastify também redige campos pessoais (`phone`, `text`, `name`, `email`, `income`, `payload`, `history`…) se alguém os logar por engano. Os logs continuam trazendo ids (mensagem, job).
- Migration `20261104120000_handoff_and_erasure`; config nova `LEAD_RETENTION_DAYS`, `RETENTION_SWEEP_MS`.

## Decisões

1. **Apagar pede confirmação.** É irreversível e uma frase solta ("apaga meus dados") pode ser dita de passagem. O custo é uma pergunta a mais; a confirmação some se o lead já tinha pedido a exclusão e responde "sim".
2. **Comando de corretor só com remetente cadastrado e só se for comando.** Assim um corretor (ou o número de teste do piloto, que pode ser o mesmo do corretor) continua conseguindo conversar como lead. Um lead que digita "assumir ABC123" não faz nada.
3. **O bot não repassa as mensagens do lead ao corretor durante o handoff.** O corretor conversa com o lead pelo próprio WhatsApp (o telefone vai no card e na confirmação do `assumir`). Encaminhar mensagens por dentro do bot é pós-MVP e exigiria um canal bidirecional.
4. **Exclusão apaga primeiro, confirma depois, e a confirmação é best-effort.** Se o envio da confirmação falhar, os dados já foram e nada é repetido. A linha da fila de entrada da mensagem em processamento sobrevive, sem endereço nem conteúdo, para a reentrega do mesmo "sim" não recomeçar uma conversa nova.
5. **Contato do CRM apagado pelo telefone**, inclusive o informado só na conversa (quando a coluna do lead está vazia por causa do LID, Fase 6), já que o CRM simulado não tem chave para `leads`.
6. **Retenção de 180 dias por padrão.** Não há prazo definido pelo jurídico ainda; o número é uma configuração, não uma regra.
7. **Limpeza do WA-AKG por script, não pelo bot.** O bot não enxerga a rede do MySQL do WA-AKG (decisão D5 de isolamento) e não é para passar a enxergar. A pendência fica gravada e auditável.
8. **O fluxo antigo `LGPD_PENDING` ("a equipe vai analisar") foi substituído.** O estado continua reconhecido para conversas antigas, mas o pedido novo vai direto para a confirmação e a exclusão.

## Resultados dos testes

`pnpm check`: **460 passed (33 arquivos)**. Arquivos novos: `packages/db/test/erasure.test.ts` e `handoff.test.ts`, `packages/presentation/test/handoff.test.ts`, `apps/bot/test/phase7.test.ts` (ponta a ponta), `log-masking.test.ts` e `retention.test.ts`; a máquina de conversa ganhou os testes de handoff por estado e de exclusão.

| Critério de aceite | Evidência |
|---|---|
| Handoff em todos os estados testado | `machine.test.ts`: `it.each` sobre 24 estados de pergunta (`NAME`…`HANDOFF_OFFER`, `LGPD_CONFIRM`, `CORRECTION_MENU`, `CONFIRM`), mais `RESULT`, `ADJUST_DOWN`, `ADJUST_TERM` e `DONE`: todos vão a `HANDOFF` com os efeitos de handoff, status e auditoria, e o histórico inclui o pedido. `phase7.test.ts`: no meio da coleta, depois do resultado, depois de `DONE` e antes do consentimento |
| Histórico repassado e bot silencioso | `phase7.test.ts`: o card ao corretor contém as mensagens do lead e do bot e o código; depois do pedido, 4 mensagens seguidas do lead não geram resposta nem novo aviso |
| Comando do corretor para assumir | `assumir`/`devolver`/`pendentes` testados com Postgres real: assumir registra o corretor e a auditoria; outro corretor é recusado; só quem assumiu devolve; a devolução volta o lead à pergunta em que estava |
| Exclusão remove dados e deixa registro mínimo auditável | `erasure.test.ts` e `phase7.test.ts`: todas as tabelas com dados do lead (inclusive `crm_contacts`, `crm_simulations`, `processed_messages`, `chat_sessions`) ficam vazias; sobra 1 linha em `audit_logs` sem telefone, nome, e-mail nem valores (o teste procura esses valores no que sobrou) e a pendência do WA-AKG |
| Logs sem telefone/renda em claro | `log-masking.test.ts`: um erro com telefone, e-mail e valor passa pelo worker e nem o log nem o `last_error` os contêm; o logger redige os campos pessoais; ids continuam visíveis |

Também validado: o SQL de limpeza do MySQL do WA-AKG rodou no WA-AKG local (tabelas e colunas existem, `ROLLBACK`, sem alterar dados).

## Não verificado

- **Fluxo no WhatsApp real:** nada desta fase foi exercitado com o WA-AKG ao vivo. Em especial: o card de handoff no celular do corretor (tamanho, legibilidade do histórico), os comandos `assumir`/`devolver` digitados de verdade e a mensagem de exclusão.
- **`wa-akg-erase.sh` de ponta a ponta:** só o SQL do MySQL foi testado (com `ROLLBACK`); a leitura de `erasure_tasks` no Postgres do compose e o laço do script não foram executados, porque o banco do compose ainda não tem a migration desta fase. Rode `--dry-run` primeiro.
- **Arquivos de mídia** no volume do WA-AKG (PDFs enviados) e as mensagens que já estão no aparelho do número do piloto não são apagados pelo script.
- **Os cards e PDFs já enviados ao corretor** não podem ser apagados pelo bot: ele só avisa o corretor. Se o aviso falhar, só há um aviso no log (sem dado pessoal) e é preciso avisar manualmente.
- **Fora do horário:** não há tratamento de expediente (spec §9 prevê "registrar e agendar retorno"); o aviso ao corretor sai na hora, em qualquer horário.
- **Troca de versão do texto de consentimento:** a versão e o texto aceito ficam gravados, mas ainda não há fluxo que peça novo aceite a quem aceitou uma versão antiga. O texto continua **ilustrativo** até o jurídico aprovar.

## Riscos

- **Reentrega logo após a exclusão:** se o processo cair depois de apagar e antes de concluir a mensagem na fila, a reentrega não acha mais a conversa e o lead recebe a saudação com o pedido de consentimento. Não vaza nada; só é estranho.
- **Corretor com o mesmo número do lead de teste:** só os comandos exatos (`assumir XXXXXX`, `devolver XXXXXX`, `pendentes`) viram comando; fora isso a conversa de lead segue normal.
- **Mascaramento por padrão de texto:** pega telefone, e-mail, R$ e números longos, mas um valor solto como "7500" dentro de uma mensagem de erro não é reconhecido. Os logs do bot não colocam conteúdo de mensagem; a segunda barreira é a redação por nome de campo.
- **Retenção apaga de verdade:** um lead parado há 180 dias some, inclusive o contato no CRM simulado. Quando o CRM for real, a exclusão precisará de um método no `CrmAdapter`.
- Os corretores do seed continuam fictícios (DDD 00): para testar o handoff de verdade, troque os telefones (Fase 6, "Como validar") e inclua-os em `ALLOWED_PHONES`.

## Como validar

1. Aplique a migration e suba o bot novo: `infra/scripts/db-setup.sh` e `docker compose up -d --build bot` (a partir de `infra/`).
2. Com um corretor real no banco (telefone dele em `brokers` e em `ALLOWED_PHONES`), do número do piloto: converse até uma pergunta qualquer e escreva "quero falar com um corretor". Confira a resposta ao lead, o card no corretor (histórico, código) e que o bot não responde mais.
3. Do WhatsApp do corretor, mande `pendentes`, `assumir <código>` e depois `devolver <código>`; confira que o lead recebe a pergunta de volta. Teste também o pedido de corretor no menu do resultado e depois de "está ótimo".
4. Do número do piloto, escreva "apagar meus dados" → "sim". Confira que `leads`, `crm_contacts` e afins ficaram vazios, que `audit_logs` tem a linha `erased_by_request` e que o corretor recebeu o aviso. Depois rode `infra/scripts/wa-akg-erase.sh --dry-run` e, se a contagem estiver certa, sem `--dry-run`.
5. Para a retenção: `LEAD_RETENTION_DAYS=1` no `infra/.env` e reinicie o bot; leads parados há mais de um dia somem na primeira passada (cuidado: apaga de verdade).
6. Logs: `docker compose logs bot` não deve mostrar telefone completo, e-mail nem valores.
