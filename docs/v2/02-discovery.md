# V2 · 02 — Discovery

Data: 2026-11-04. Fonte: o código em `main` (`eca2828`), o [check do projeto](../06-check-projeto.md) e a pasta `elevare-construtora/`. Itens não confirmados estão marcados `[verificar]`.

## 1. Estado atual (verificado no código)

| Área | Hoje | Relevância para a V2 |
|---|---|---|
| Início da conversa | Só **receptivo**: o lead escreve primeiro. O consentimento LGPD é a 1ª pergunta no WhatsApp ([`orchestrator.ts`](../../apps/bot/src/orchestrator.ts)). | O formulário inverte isso: o consentimento vem do site e o bot escreve primeiro. |
| Empreendimentos no fluxo | **Um só.** `FlowEnv.developmentName` + `listActiveTypologies(db)`. O seed usa "Residencial Exemplo". | O site tem 3 empreendimentos. O bot precisa saber de qual o lead veio. |
| Motor | Focado no **financiamento bancário**: linhas de crédito, LTV, capacidade de 30%, Price/SAC, FGTS, subsídio. A entrada é a diferença entre o preço e o financiável ([`simulate.ts`](../../packages/simulation/src/simulate.ts)). | O foco muda: a entrada vira o produto principal e o banco vira estimativa. |
| Fluxo de obra | [`buildConstructionFlow`](../../packages/simulation/src/construction-flow.ts) divide a entrada em sinal, mensais (até a entrega) e reforços, em centavos exatos. Não tem juros, correção, ato mínimo ou limite de parcelas. A capacidade só gera um alerta. | **Base do modo 3.** Precisa virar plano com regras da construtora e solver. |
| Parâmetros do empreendimento | `Development.signalRatio`, `balloonRatio`, `balloonIntervalMonths`, `deliveryDate`. Sem vigência nem versão. | Viram uma **condição comercial versionada**. |
| Parâmetros financeiros | `ParameterSet` + `CreditLine` com vigência, imutáveis, auditados, editados pela CLI. | São reaproveitados como "financiamento simulado" no painel. |
| Textos do bot | Fixos em [`templates.ts`](../../packages/conversation/src/templates.ts). As etapas ficam em `STEPS` ([`steps.ts`](../../packages/conversation/src/steps.ts)). | O editor de fluxo precisa de textos no banco, com os do código como padrão. |
| Canal | `sendText`, `sendList` (com `legacyText`), `sendDocument`, presença. **Não tem botões.** `restrictChannel` aplica `ALLOWED_PHONES`. | Botões (ajustes.txt item 1) e envio ativo. |
| Fila de saída | `DeliveryJob` (`CRM_SYNC`, `BROKER_NOTIFY`, `HANDOFF_NOTIFY`) com retry. | Novo tipo `FIRST_CONTACT` sem criar outra infraestrutura. |
| Usuários | Não há. `AuditLog.actor` é texto livre. | O painel precisa de login e papéis (RF-51). |
| Site | HTML estático, 3 empreendimentos (Lumen Urban, Parc Verde, Altomare). Sem preços, sem formulário, sem CTA de WhatsApp. | Vira um app com dados do banco e formulário. |
| Pendências do MVP | 06-check: §3.1 Docker desatualizado, §3.2 número real nos exemplos, §3.3 FAQ promete registro, §3.4 folga de 15% fixa no código, §3.6 botões não testados. Nada testado no WhatsApp real desde a Fase 3. | Precisam ser fechadas antes de construir em cima. |

## 2. As 3 formas de pagamento (proposta de regra)

Todas as regras abaixo são **parâmetros da condição comercial do empreendimento**. Os valores de exemplo são `ILUSTRATIVO` até o financeiro da construtora validar.

| Modo | O que o lead faz | O que o motor calcula | O que o bot coleta |
|---|---|---|---|
| **1. À vista** | Paga o preço total. | Preço com desconto à vista (ex.: 8%). Não há análise de renda. | Só a confirmação da unidade. Vai direto para o corretor (lead quente). |
| **2. Entrada à vista + financiamento** | Paga a entrada no ato e financia o saldo nas chaves. | Entrada mínima (ex.: 20% do preço) e checagem do dinheiro disponível. Saldo a financiar. Opcional: estimativa da parcela do banco. | Dinheiro disponível. Se o painel ligar a estimativa: renda, dívidas e data de nascimento. |
| **3. Entrada parcelada com a construtora + financiamento** | Paga o ato, parcelas mensais até as chaves, reforços opcionais e, nas chaves, financia o saldo. | **Plano da entrada** (ato, N mensais, K reforços, parcela de chaves), comprometimento de renda, parecer e sugestões. Opcional: estimativa do banco. | Renda, tipo de renda, dívidas, co-proponente, dinheiro para o ato, parcela desejada, aceita reforços. |

### Regras do modo 3 (proposta)
- **Entrada** = maior valor entre a entrada mínima (% do preço) e a entrada que o lead quer dar, limitada à entrada máxima.
- **Ato** = maior valor entre o ato mínimo (% da entrada e piso em R$) e o dinheiro que o lead tem hoje, limitado à entrada.
- **Mensais**: N = menor valor entre (meses até a entrega − 1) e o máximo da condição. Cada parcela tem um valor mínimo (ex.: R$ 300).
- **Reforços**: semestrais ou anuais, até X% da entrada. São opcionais: se o lead recusar, o valor vai para as mensais.
- **Parcela de chaves** (opcional): % da entrada paga na entrega.
- **Juros da construtora**: padrão 0% até as chaves. Se for maior que zero, as mensais saem pela Price.
- **Correção (INCC)**: exibida como aviso ("valores corrigidos mensalmente pelo INCC"). Uma projeção estimada é opcional, com taxa parametrizada; o padrão é mostrar os valores nominais.
- **Capacidade**: parcela mensal ≤ renda familiar × limite da construtora (ex.: 30%) − dívidas.
- **Solver**: se a mensal não cabe na capacidade ou na parcela desejada, o motor tenta nesta ordem:
  1. Usar mais reforços, se o lead aceitar.
  2. Aumentar o ato até o dinheiro disponível.
  3. Calcular o **ato necessário** para caber.

  A diferença dentro da tolerância dá **viável com ajustes**; acima dela, **inviável**. Sugestões: unidade menor, co-proponente, aceitar reforços.
- **Saldo nas chaves** = preço − entrada. A estimativa do banco reaproveita o motor atual com a página "Financiamento simulado" e gera alerta se a parcela futura não couber.

## 3. Lacunas e riscos

| # | Achado | Gravidade |
|---|---|---|
| G11 | **Contato ativo pelo Baileys.** Escrever primeiro para um número é o comportamento de maior risco de ban. O opt-in no formulário reduz o risco, mas não o elimina. | **Alta** |
| G12 | **Formulário com número de terceiro.** Alguém pode digitar o telefone de outra pessoa, e o bot vai escrever para um desconhecido (ban e LGPD). | **Alta** |
| G13 | **LID depois do envio ativo.** Mandamos para `55…@s.whatsapp.net`, mas a resposta pode chegar como `@lid` e não casar com o lead do formulário `[verificar com número real]`. | Média |
| G14 | **Regras da entrada parcelada não existem por escrito** (INCC, juros, ato mínimo, limite de comprometimento, análise de crédito da construtora). | Alta |
| G15 | **O painel é uma nova superfície de ataque**, com acesso a dados pessoais e a regras financeiras. | Alta |
| G16 | **Texto editável pode quebrar a conformidade** (remover aviso legal, prometer aprovação). | Média |
| G17 | O conceito de "entrada" muda: hoje ela é o déficit do banco; na V2 é uma regra comercial. Um mesmo campo com dois significados confunde PDF, dossiê e CRM. | Média |
| G18 | Os botões interativos do WA-AKG continuam sem teste em aparelho real (G5 do MVP). | Média |
| G19 | O site precisa estar acessível na internet para a demo (HTTPS, domínio). Hoje a infra só roda local, com a rede `edge` de desenvolvimento. | Média |
| G20 | Existe endpoint no WA-AKG para checar se o número tem WhatsApp antes de enviar? `[verificar]` | Baixa |

## 4. Decisões que dependem do usuário

| # | Decisão | Recomendação |
|---|---|---|
| D6 | Contato ativo pelo WA-AKG (não oficial) após o formulário? | **Sim, só na demo e no piloto**, com opt-in + *double opt-in* na 1ª mensagem + limite/hora + botão `wa.me` na página de obrigado como plano B (o lead escreve primeiro). |
| D7 | Stack do site e do painel. | **Next.js (App Router) + Tailwind + shadcn/ui**, em dois apps (`apps/site`, `apps/painel`) que acessam o banco por `@mvp/db` no servidor. |
| D8 | Autenticação do painel. | **Login próprio** (e-mail + senha com argon2, sessão em cookie httpOnly) e papéis `ADMIN`, `GERENTE`, `CORRETOR`. Sem SSO. |
| D9 | Regras do modo 3 (seção 2). | Aceitar a proposta como `ILUSTRATIVO` e pedir ao cliente os números reais na demo. |
| D10 | Estimativa do financiamento do saldo. | **Sim, opcional** (liga e desliga no painel), sempre rotulada como "estimativa", usando o motor atual. |
| D11 | Até onde vai o "configurar cada etapa". | **Editor de etapas**, não um construtor visual livre: editar textos e botões, ligar e desligar as etapas opcionais e publicar uma versão com prévia. |
| D12 | Onde roda a demo para o cliente. | **VPS com Docker Compose + domínio + TLS** (Caddy). O local fica só para desenvolvimento. |

## 5. Próximo passo
D6–D12 **aprovadas** em 2026-11-04, todas conforme a recomendação (registro em [`03-impactos.md`](03-impactos.md)). Execução pelo [`04-plano.md`](04-plano.md), começando pelas Fases 9 e 10.
