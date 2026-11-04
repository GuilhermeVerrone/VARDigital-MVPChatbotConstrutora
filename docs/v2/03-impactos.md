# V2 · 03 — Impactos

Data: 2026-11-04. Decisões aprovadas pelo usuário em 2026-11-04 (todas conforme a recomendação do [discovery](02-discovery.md#4-decisões-que-dependem-do-usuário)):

| # | Decisão |
|---|---|
| D6 | Contato ativo pelo WA-AKG **só na demo e no piloto**, com opt-in, *double opt-in*, limite/hora e `wa.me` como plano B. |
| D7 | Site e painel em **Next.js + Tailwind + shadcn/ui**, dois apps, banco via `@mvp/db` só no servidor. |
| D8 | **Login próprio** (argon2, cookie httpOnly) com papéis `ADMIN`, `GERENTE`, `CORRETOR`. |
| D9 | Regras do modo 3 conforme o discovery §2, como **`ILUSTRATIVO`**, a validar com a construtora. |
| D10 | Estimativa do financiamento do saldo **opcional**, liga e desliga no painel. |
| D11 | **Editor de etapas** (textos, botões, etapas opcionais, versões), sem construtor visual livre. |
| D12 | Demo em **VPS com Docker Compose + domínio + TLS**. |

## 1. Impacto no spec.md

| Seção | Mudança |
|---|---|
| §1.1, §1.3 | O objetivo passa a incluir "captar o lead no site e qualificar a forma de pagamento". |
| §1.4 | Saem do "fora de escopo": painel admin (versão enxuta) e editor de textos. Entra: construtor visual de fluxo livre, pagamento ou assinatura online, índice INCC em tempo real. |
| §3.1 | Novo **RF-01b**: início da conversa pelo formulário do site (contato ativo com *double opt-in*). Novo **RF-01c**: escolha do empreendimento quando o lead chega sem formulário. |
| §3.2 | O formulário coleta nome, WhatsApp, e-mail (opcional), empreendimento, tipologia, consentimento LGPD e opt-in de WhatsApp. O bot não pergunta de novo o que já veio. |
| §3.3 | Novo **RF-15b**: forma de pagamento (3 modos). **RF-23** reescrito: plano da entrada parcelada com ato, mensais, reforços, chaves, capacidade e solver. O financiamento bancário (RF-16 a RF-22) vira **estimativa opcional** do saldo. |
| §3.4 | As sugestões ganham "aceitar reforços", "aumentar o ato" e "trocar para entrada parcelada" (do modo 2 para o 3). |
| §3.5 | Score simples: à vista = quente; modo 3 viável = quente ou morno; inviável = frio. |
| §3.9 | RF-45, RF-46, RF-47 (agora "condições comerciais"), RF-49 (editor de etapas), RF-50 (funil simples), RF-51 (3 papéis) e RF-52 entram no escopo, em versão enxuta. RF-48 continua fora. |
| §4 | Nova §4.7 "Entrada parcelada com a construtora" com as fórmulas do discovery §2. O texto sobre a entrada no §4.3 passa a explicar os dois significados (regra comercial × déficit do banco). |
| §10 | Novos modelos (ver §3 abaixo). |
| §15 | Novos riscos G11, G12, G15 e G16. |

## 2. Impacto na arquitetura

```
                ┌──────────── apps/site (Next.js, público) ────────────┐
 Visitante ───▶ │ páginas dos empreendimentos (dados do banco)          │
                │ formulário ─▶ Server Action: valida, anti-spam,       │
                │   cria/atualiza Lead + Consent + DeliveryJob          │
                │   FIRST_CONTACT ─▶ página de obrigado (+ wa.me)       │
                └───────────────────────────┬───────────────────────────┘
                                            ▼
                                  Postgres do bot (@mvp/db)
                                            ▲
 WhatsApp ⇄ WA-AKG ⇄ apps/bot ──────────────┤  delivery worker envia FIRST_CONTACT
                     (orquestrador lê       │  orquestrador lê FlowConfig + SalesCondition
                      FlowConfig publicado) │  motor único: packages/simulation
                                            ▼
                ┌──────────── apps/painel (Next.js, autenticado) ──────┐
 Equipe ──────▶ │ leads · empreendimentos/unidades · condições          │
                │ comerciais · financiamento simulado · fluxo do bot    │
                │ (editor + simulador de conversa) · corretores ·       │
                │ auditoria · status do WhatsApp                        │
                └───────────────────────────────────────────────────────┘
```

- **O banco é a fonte única.** O site lê os empreendimentos publicados. O painel escreve versões novas. O bot lê as versões vigentes (cache de 60 s, como hoje).
- **O site não chama o bot.** Ele grava o lead e um job. O worker de entrega, que já existe e tem retry, envia a 1ª mensagem. Com o WhatsApp fora, o lead não se perde.
- **O simulador de conversa do painel** roda a mesma máquina de estados com um `ChannelAdapter` em memória. Não envia nada pelo WhatsApp. Serve para testar o fluxo antes de publicar e é o "palco" da demo.
- **Motor único**: a calculadora de prévia do painel chama `packages/simulation` no servidor.

## 3. Impacto nos dados (Prisma)

| Modelo | Mudança |
|---|---|
| `User` (novo) | Nome, e-mail, hash da senha, papel (`ADMIN`/`GERENTE`/`CORRETOR`), `brokerId?`, ativo. `AuditLog.actor` passa a guardar o id do usuário. |
| `UserSession` (novo) | Sessão do painel: token com hash, expiração, IP e user-agent. |
| `Development` | + `published`, `heroImage`, `address`, `highlights`, `gallery`. Os campos `signalRatio`/`balloonRatio`/`balloonIntervalMonths` migram para a condição comercial. |
| `SalesCondition` (novo) | **Versionada, com vigência e imutável** (mesmo padrão de `ParameterSet`), uma série por empreendimento. Campos: desconto à vista, entrada mín./máx., ato mínimo (% e R$), máximo de mensais e valor mínimo da parcela, reforços (intervalo, % máx.), % de chaves, juros a.m., índice e projeção, limite de comprometimento, tolerância, estimativa do banco ligada/desligada, status `ILUSTRATIVO`/`VALIDADO`. |
| `FlowConfig` (novo) | **Versionada** (rascunho → publicada): textos por chave, etapas opcionais ligadas/desligadas, botões por etapa, mensagem de 1º contato. Sem rascunho publicado, valem os textos de `templates.ts`. |
| `Lead` | + `developmentId`, `source` (`SITE_FORM`/`WHATSAPP`), `utm` (json), `formSubmittedAt`, `contactConfirmedAt`, `paymentMode`. Os campos `origin`/`campaign` já existem. |
| `Simulation` | + `paymentMode`, `salesConditionId` (versão), `downPaymentPlan` (json), `bankEstimate` (json, opcional). `creditLineId` e `parameterSetId` passam a ser opcionais (o modo 1 não usa banco). |
| `FinancialProfile` | + `cashNow` (dinheiro para o ato), `acceptsBalloons`. `birthDate` só é exigido se a estimativa do banco estiver ligada. |
| `DeliveryJob.kind` | + `FIRST_CONTACT`. |
| `FormSubmission` (novo, opcional) | Registro mínimo para o rate limit e a auditoria do formulário: hash do IP, hash do telefone, data e resultado. Sem dado pessoal em claro. |

Migrations aditivas. O seed troca o "Residencial Exemplo" pelos **3 empreendimentos Elevare** com unidades, preços e condições `ILUSTRATIVO`.

## 4. Impacto no motor (`packages/simulation`)

- Nova função pura `simulatePayment(input, condition, financingParams?)` com união discriminada por modo. O resultado tem `mode`, `verdict`, `plan` (modos 2 e 3), `bankEstimate?`, `suggestions` e `alerts`.
- `buildConstructionFlow` evolui para `buildDownPaymentPlan`:
  - ato mínimo;
  - mensais com teto e piso;
  - reforços opcionais;
  - parcela de chaves;
  - juros pela Price, quando houver;
  - projeção de correção apenas informativa.

  Os centavos continuam exatos: a soma do plano é igual à entrada.
- Novo solver de capacidade e parcela desejada para o modo 3, com tolerância parametrizada (resolve o 06-check §3.4: a folga de 15% sai do código).
- O `simulate()` atual continua existindo e vira o cálculo da **estimativa do banco** sobre o saldo nas chaves. Os testes atuais continuam valendo.
- Novos casos de referência numa planilha à parte, com 3 modos × viável/ajustes/inviável × com e sem reforços.

## 5. Impacto na conversa e no canal

- **Início pelo formulário.** O estado inicial é `CONTACT_CONFIRM`: "Oi, {nome}! Aqui é a Elevare. Você pediu uma simulação do {empreendimento} no nosso site, certo?". "Sim" segue. "Não" encerra, marca o lead e não escreve mais.
- **Início pelo WhatsApp** (sem formulário). Mantém o consentimento no chat e ganha a etapa `DEVELOPMENT` (escolher o empreendimento).
- **Novos estados:** `PAYMENT_MODE` e, depois dele, um ramo por modo:
  - **À vista:** `CASH_OFFER` → corretor.
  - **Entrada à vista:** `DOWN_CASH` → (perfil, se a estimativa estiver ligada) → resultado.
  - **Entrada parcelada:** perfil → `CASH_NOW` → `DESIRED_INSTALLMENT` → `BALLOONS` → confirmação → resultado.
- **Resultado do modo 3:** mostra o plano em lista. O menu de ajustes passa a ter "mudar o ato", "aceitar ou recusar reforços", "outra unidade" e "falar com corretor".
- `STEPS` passam a ler o texto do `FlowConfig`. As etapas opcionais (e-mail, co-proponente, data de nascimento, parcela desejada) podem ser desligadas no painel.
- **Botões** (`sendButtons` no `ChannelAdapter`), se o teste em aparelho der certo. Sempre com o texto numerado como alternativa. Se o teste falhar, o fallback continua sendo a lista em texto.
- **Identidade com LID.** O lead do formulário é casado pelo telefone. Se a resposta vier como `@lid`, a página de obrigado oferece o código curto (`ELV-4821`) no texto do `wa.me`, e o bot também aceita o código digitado no chat.
- Dossiê, PDF, CRM simulado e card do corretor passam a mostrar o modo e o plano da entrada.

## 6. Impacto em LGPD, segurança e conformidade

| Tema | Resposta |
|---|---|
| Consentimento no site | Checkbox desmarcado por padrão. Texto versionado gravado como snapshot em `Consent` (`channel = WEB`). Opt-in de WhatsApp separado do consentimento de dados. |
| Número de terceiro (G12) | *Double opt-in*: a 1ª mensagem só pergunta se a pessoa pediu a simulação. "Não" ou silêncio por 48 h encerra e não envia mais nada. Rate limit por IP e por telefone, honeypot e checagem de tempo de preenchimento. Captcha (Turnstile) se houver abuso. |
| Painel (G15) | Login obrigatório, senha com argon2, cookie httpOnly/SameSite, CSRF nativo das Server Actions, bloqueio após tentativas, papéis por rota. Corretor vê só os próprios leads. Leitura de dado pessoal no painel fica registrada na auditoria. Headers de segurança. |
| Textos editáveis (G16) | Consentimento e avisos legais em blocos travados (só `ADMIN` edita, com nova versão). Linter de palavras proibidas ("aprovado", "garantido", "taxa de X%"). Validação das variáveis antes de publicar. |
| Exclusão de dados | O fluxo da Fase 7 passa a cobrir `FormSubmission` e o novo campo `utm`. |

## 7. Impacto em infra e esforço

- **Compose:** + `site` e `painel`, + Caddy como borda com TLS e domínio (D12). A rede `edge` de desenvolvimento continua só no local.
- **Monorepo:** `apps/site` e `apps/painel` + `packages/ui` (tokens Elevare e componentes compartilhados entre os dois apps).
- **Testes:** os unitários do motor e da conversa continuam no Vitest. Entra o Playwright para o ponta a ponta site → formulário → (canal falso) → painel.
- **Ollama:** sem mudança. O site e o painel não usam LLM.

**Dentro da V2:** os 3 modos de pagamento, o site com formulário, o 1º contato ativo, o painel (leads, empreendimentos/unidades, condições comerciais, financiamento simulado, editor de etapas + simulador, corretores, auditoria) e o roteiro de demo.
**Fora da V2:** construtor visual de fluxo, CRM real, API oficial do WhatsApp, follow-up automático, métricas avançadas, distribuição com SLA, upload de planilha de preços, integração com índice INCC.

## 8. Riscos novos ou elevados

| Risco | Nível | Resposta |
|---|---|---|
| Ban por contato ativo (G11) | Alto | *Double opt-in*, limite/hora, janela de horário, número dedicado e `wa.me` como alternativa. Medir na Fase 9 antes de construir o resto. |
| Mensagem para terceiro (G12) | Alto | *Double opt-in* + anti-spam no formulário. |
| Regras do modo 3 erradas (G14) | Alto | Tudo parametrizado e `ILUSTRATIVO`. Validar com o financeiro na demo, sem precisar mexer no código. |
| Vazamento pelo painel (G15) | Alto | Auth + papéis + auditoria + revisão de segurança (`/security-review`) na Fase 16. |
| Escopo do painel crescer | Médio | Editor de etapas, não construtor livre (D11). Cada tela com aceite fechado. |
| Demo depender do WhatsApp real | Médio | O simulador de conversa do painel é o plano B ao vivo. |
