STATUS: PASS (testes automatizados) — falta a validação com WhatsApp real

# Fase 6 — Apresentação, dossiê e CRM simulado

**Resumo:** depois que o lead confirma os dados, o bot roda o motor, mostra o resultado com aviso legal, deixa o lead ajustar entrada e prazo (com recálculo) e pedir o PDF. Em paralelo, o corretor recebe o card e o PDF, e o lead é criado/atualizado no CRM simulado sem duplicar por telefone, por uma fila que tenta de novo se algo falhar. Passou em testes automatizados contra Postgres real (`pnpm check`: lint, typecheck e **371 testes**, 65 a mais que na Fase 5). A imagem Docker do bot gera com os pacotes novos. **Não** foi testada com WhatsApp real (ver "Não verificado").

## O que foi feito

- **Resultado ao lead** (`@mvp/presentation`, novo, puro): mensagem do parecer (viável / com ajustes / inviável) com entrada, financiamento, parcelas, fluxo de obra, pontos de atenção e sugestões, em texto fixo com os números do motor; mensagem de aviso legal separada (indicativa, não é aprovação, data e hora, marca de parâmetros ILUSTRATIVOS). Nenhuma passa por LLM.
- **Ajustes (RF-27):** menu depois do resultado (mudar entrada, mudar prazo, receber o PDF, está ótimo). Entrada e prazo recalculam e gravam uma nova simulação. "Mudar a entrada" digitado como comando também vale como ajuste. `corrigir <dado>` volta à confirmação e recalcula do zero.
- **Dossiê** (spec §6): card de texto com cliente, interesse, simulação, alertas, próximo passo e classe (quente/morno/frio) pelo parecer. Atualizações vêm marcadas ("SIMULAÇÃO ATUALIZADA", com o cenário do lead).
- **PDF simples** (`pdf-lib`): imóvel, perfil informado, resultado, fluxo de obra, pontos de atenção, aviso legal com data e hora e versão dos parâmetros. Sem identidade visual (pós-MVP).
- **CRM** (`@mvp/crm`, novo): `CrmAdapter` (interface estável, com **teste de contrato** reutilizável) e `SimulatedCrm` em tabelas próprias (`crm_contacts`, `crm_simulations`). Contato único por telefone; anexar a mesma simulação duas vezes não duplica; o responsável não muda quando outro corretor é informado depois.
- **Fila de entregas** (`delivery_jobs`, mesmo desenho da fila de entrada): `BROKER_NOTIFY` e `CRM_SYNC`, gravados na **mesma transação** do estado da conversa; reserva que expira, espera crescente entre tentativas, `DEAD` com o último erro. Um job não atrasa o outro: CRM fora do ar não segura o aviso ao corretor.
- **Corretor:** atribuição round-robin (quem atendeu há mais tempo recebe o próximo; inativo é ignorado; lead já conhecido do CRM vai para o responsável), card por WhatsApp e PDF anexo. Migration `20261030120000_crm_and_delivery_jobs`.
- **Orquestrador:** `CONFIRM` sim → grava o perfil e vai para `SIMULATING`; o cálculo e a apresentação são a segunda metade do turno e retomam sozinhos se o processo cair no meio (reentrega ou mensagem seguinte).
- **Config nova:** `DELIVERY_POLL_MS`, `DELIVERY_LOCK_MS`, `DELIVERY_MAX_ATTEMPTS` (8), `BROKER_CONTACT_MINUTES` (5, só texto do "próximo passo").

## Decisões

1. **O corretor recebe o dossiê logo no primeiro resultado**, não quando o lead "finaliza": é o que garante "nenhum lead se perde" se ele sumir depois. Cada ajuste gera uma simulação nova e um **segundo** card+PDF marcado como atualização (pode ser ruído se o lead ajustar várias vezes; ver Riscos).
2. **Sem score numérico.** O score configurável é pós-MVP (spec §1.4, RF-28 a RF-30). A classe do dossiê e `leads.score_class` vêm do parecer (viável → quente, com ajustes → morno, inviável → frio); `leads.score` continua vazio.
3. **Unidade de referência = a mais barata disponível da tipologia escolhida.** O lead escolhe tipologia, não unidade; a mensagem cita a unidade e o valor usados.
4. **Ajuste de entrada = cenário, não correção do dado.** O valor vale só para aquela simulação (o motor usa a entrada inteira, `useFullDownPayment`) e o perfil financeiro não muda; o card mostra "Cenário do lead".
5. **Números só do motor.** As mensagens são templates; o LLM continua só interpretando a resposta do lead. Um auditor (`unexplainedNumbers`) confere cada número do texto contra a entrada e o resultado do motor; é o teste pedido pelo critério de aceite.
6. **Entrega atômica com o estado** (`saveTurn` ganhou `jobs`): não existe "estado avançou, entrega perdida". Em troca, uma queda **antes** da gravação deixa uma simulação sem uso no banco (inofensiva, sem entrega).
7. **Progresso do job:** se o PDF falha depois de o card sair, a nova tentativa não repete o card (`cardSent` no payload do job).
8. **Mesma pessoa por endereço diferente (LID):** o `leads.phone` é único, então o segundo lead fica sem telefone na coluna. O CRM e a atribuição usam o telefone informado na conversa, e assim caem no mesmo contato e no mesmo corretor, que recebe o aviso "Lead já existia no CRM".
9. **Mudança de comportamento da Fase 5:** depois do "sim" na confirmação o estado não é mais `DONE` e sim `SIMULATING` → `RESULT`; a mensagem "Já já te mostro a simulação" foi substituída. Os testes antigos foram ajustados. A dica de erro do menu de correção, que dizia "sim ou não", foi corrigida de passagem.
10. **Falha que repetir não resolve** (sem unidade disponível, dado faltando, sem parâmetros vigentes) vira oferta de corretor (handoff) em vez de erro repetido; falha de banco/rede repete pela fila.

## Resultados dos testes

`pnpm check`: **371 passed (27 arquivos)**. Novos: 21 de apresentação, 5 do CRM (contrato + simulado), 8 de fila/atribuição no `db`, 11 da máquina de conversa, 20 de ponta a ponta no bot (`apps/bot/test/phase6.test.ts`, 6 rodadas seguidas sem falha).

| Critério de aceite | Evidência |
|---|---|
| Corretor recebe card + PDF em ≤ 1 min | `phase6.test.ts`: o teste mede do "sim" de confirmação até o card e o PDF chegarem ao corretor e exige menos de 60 s (passou nas execuções, com o relógio real); PDF começa com `%PDF-`, card tem classe, telefone, fluxo de obra e próximo passo |
| Mesmo telefone não duplica lead | CRM: contrato (upsert repetido e 5 simultâneos → 1 contato); ponta a ponta: ajuste do mesmo lead e segunda conversa por LID com o mesmo telefone → 1 contato, 2 simulações anexadas, mesmo corretor, aviso "Lead já existia" |
| Falha forçada do CRM enfileira e reenvia | CRM que falha 2 vezes: o corretor recebe sem esperar, o job do CRM faz 3 tentativas e conclui, 1 contato; CRM fora por tempo demais: job `DEAD` com `last_error`, lead intacto |
| Nenhum número da mensagem vem do LLM (teste compara) | `presentation.test.ts`: em 8 cenários (3 pareceres, sem parcela, sem linha, idade, co-proponente, sem obra) todo número da mensagem, do card e do PDF está na entrada/resultado do motor; o auditor também reprova um número inventado. `phase6.test.ts`: com um LLM que "inventa" preços, o fallback nem é chamado e os números das mensagens enviadas batem com a simulação gravada |
| Aviso legal na conversa e no PDF | mensagem própria com data e hora; PDF com as três frases do spec §4.8, data/hora e versão dos parâmetros |
| Queda no meio | `SIMULATING` gravado; reentrega termina o cálculo sem repetir a etapa e sem duplicar simulação nem entregas; mensagem nova termina o cálculo antes de ser tratada |

## Não verificado

- **Fluxo no WhatsApp real:** nada desta fase foi exercitado com o WA-AKG ao vivo. Em especial o **envio de PDF** (`/messages/.../media`) só tinha teste com `fetch` simulado (Fase 3) e agora é a parte mais importante da entrega ao corretor. A leitura do resultado (clareza, tom, tamanho das mensagens no celular) é sua.
- **Corretores do seed são fictícios** (DDD 00): o bot não alcança ninguém com eles. Para testar de verdade, troque os telefones (ver "Como validar") e inclua-os em `ALLOWED_PHONES`.
- Concorrência real (vários leads ao mesmo tempo) além do que os testes cobrem; um único worker de entregas.
- Os valores são os do **seed ILUSTRATIVO** (linhas, taxas, subsídio): a conferência com o financeiro continua pendente.
- O PDF foi validado por estrutura e conteúdo (texto extraído), não visualmente em um leitor.

## Riscos

- **LGPD (Fase 7):** `crm_contacts` e `crm_simulations` **não** têm chave para `leads`, de propósito (é "outro sistema"), então a exclusão do titular não as apaga sozinha; precisa ser incluída no fluxo de exclusão, junto com `simulations` (guarda entrada e resultado, com nascimento e renda) e o que o WA-AKG guarda.
- O corretor pode receber vários cards seguidos se o lead ajustar muitas vezes. Se incomodar, a alternativa é só avisar no fim da conversa (o preço é perder o lead que some depois do primeiro resultado).
- O `DEAD` de entrega só aparece no log e na tabela (`delivery_jobs`); ainda não há alerta ao administrador (Fase 8).
- O "próximo passo" fala em ligar em 5 minutos, mas **não há SLA nem reatribuição** (pós-MVP): é só a orientação ao corretor.
- A atribuição round-robin não considera escala nem horário; fora do expediente o card chega do mesmo jeito.
- Texto de consentimento e avisos continuam **ilustrativos** até o jurídico aprovar.

## Como validar

1. Aplique a migration no banco do compose: `infra/scripts/db-setup.sh` (o container do bot não migra sozinho) e `docker compose up -d --build bot`.
2. Coloque números reais nos corretores e libere-os no bot, por exemplo:
   `docker compose exec bot-db psql -U bot -d bot -c "update brokers set phone='55SEUNUMERO' where phone='5500900000001'"` e acrescente o mesmo número em `ALLOWED_PHONES` (`infra/.env`).
3. Do número liberado, converse até o fim ("sim" na confirmação). Confira: resultado e aviso legal no chat, card + PDF no número do corretor, e no banco `select status, score_class from leads`, `crm_contacts`, `crm_simulations`, `delivery_jobs`.
4. Teste: mudar a entrada, mudar o prazo, "receber o PDF", `corrigir renda` depois do resultado, "falar com corretor", e derrubar o container logo após o "sim" para ver a retomada.
5. Para forçar falha do CRM: pare o `bot-db` por alguns segundos durante a entrega e confira `delivery_jobs` (`attempts`, `last_error`) voltando a `DONE`.
