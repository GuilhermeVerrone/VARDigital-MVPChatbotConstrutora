# V2 · 04 — Plano faseado

Regra: uma fase por vez. Só avança com o critério de aceite verde e a aprovação do usuário. As fases continuam a numeração do MVP. Os relatórios ficam em `docs/fases/fase-N.md`.
Stack nova: Next.js (App Router) + Tailwind + shadcn/ui, Playwright, **API da Anthropic** para o LLM (D13). O resto segue igual (Node/TS, Fastify, Prisma, Vitest, Zod, WA-AKG). O Ollama vira perfil opcional do compose. Alvo de execução: VPS de 4 GB de RAM (D14).
Estrutura alvo: + `apps/site`, `apps/painel`, `packages/ui`. Os pacotes existentes evoluem.

## Fase 9 — Fechar o MVP e testar os riscos no aparelho
**Entrega:**
- Correções do [06-check](../06-check-projeto.md): §3.2 número real nos exemplos, §3.3 FAQ que promete registro, §3.5 relatório da Fase 8 e §3.1 ambiente Docker atualizado.
- **Teste no WhatsApp real** com o número dedicado:
  1. Botões do `/interactive`: aparecem? funcionam no Android, no iOS e na web?
  2. Envio ativo para um número que nunca falou com a sessão.
  3. A resposta a esse envio chega como `@lid` ou como telefone?
  4. Existe checagem de número no WA-AKG (G20)?
- Resultados em `docs/fases/fase-9.md`.

**Aceite:** `pnpm check` verde. Os 4 testes registrados com evidência (print/log). Decisão final sobre botões e sobre o casamento por LID.
**Por que primeiro:** G11, G13 e G18 mudam o desenho das Fases 12 e 13. Melhor descobrir antes.

## Fase 10 — Motor v2: três formas de pagamento (puro)
**Entrega:**
- `packages/simulation`: schema `SalesCondition` (Zod) e `simulatePayment()` para os 3 modos.
- `buildDownPaymentPlan`:
  - ato mínimo;
  - mensais com teto e piso;
  - reforços opcionais;
  - chaves;
  - juros pela Price;
  - projeção de correção informativa.
- Solver de capacidade e parcela desejada. A tolerância vira parâmetro (fecha o 06-check §3.4).
- Estimativa do banco sobre o saldo, reaproveitando o `simulate()`.
- Seed `ILUSTRATIVO` de condições para os 3 empreendimentos Elevare.

**Aceite:**
- Testes com casos de referência: 3 modos × viável/ajustes/inviável, com e sem reforços, com juros 0 e > 0, entrega próxima (0–2 meses) e distante.
- Soma do plano = entrada em centavos exatos (teste de propriedade).
- Nenhuma regra de negócio fixa no código.
- Os testes do motor atual continuam verdes.

**Depende de:** nada externo. Pode rodar em paralelo à Fase 9.

## Fase 11 — Dados v2 e multi-empreendimento
**Entrega:**
- Migrations aditivas ([impactos §3](03-impactos.md#3-impacto-nos-dados-prisma)): `User`, `UserSession`, `SalesCondition` versionada (vigência, imutável, auditada), `FlowConfig` versionada.
- Campos novos em `Lead`, `Simulation`, `FinancialProfile` e `Development`, e o tipo `FIRST_CONTACT` em `DeliveryJob`.
- Repositórios com vigência, no mesmo padrão de `parameters/repository.ts`.
- Seed com os 3 empreendimentos Elevare, unidades e preços `ILUSTRATIVO`, 1 usuário admin de demo e corretores fictícios.
- `simulation-service` grava o modo, o plano e as versões usadas.
- Script `demo-reset`.

**Aceite:**
- Simulação lê a condição vigente na data e grava a versão.
- Publicar uma nova condição gera histórico e auditoria.
- `prisma migrate diff` vazio.
- `demo-reset` volta ao estado inicial de forma idempotente.

## Fase 11b — LLM na Anthropic e stack enxuta para VPS barata
**Entrega:**
- `AnthropicClient` ao lado do `OllamaClient` (mesma interface `LlmClient`), com saída JSON validada por Zod, timeout, retry e limite de chamadas por conversa. Escolha por `LLM_PROVIDER=anthropic|ollama` e `LLM_MODEL` (padrão: Haiku 5.5). Chave só em `.env`.
- **Minimização de dados:** a requisição leva só o texto da resposta e a definição do campo, sem nome, telefone nem e-mail, e com máscara. O conteúdo não vai para os logs.
- Prompt `extraction.v3` (já com os campos `paymentMode`, `acceptsBalloons` e `cashNow`) e nova rodada da bateria de `packages/llm/eval`, registrando acerto, injeção, latência e custo por 1.000 turnos.
- Compose: Ollama passa para o perfil `ollama` (desligado por padrão), `mem_limit` por container, MySQL do WA-AKG com buffer reduzido, script de swap, checks de dependência pelo provedor configurado.
- **Medição de memória:** `docker stats` com a stack padrão sob carga (conversas simuladas), em máquina de 4 GB ou limitada a isso.
- Texto provisório de consentimento e privacidade citando a Anthropic (`RASCUNHO`).

**Aceite:**
- Bateria com a Anthropic ≥ resultado da Fase 4 (LLM ≥ 85% e injeção 100% pelo pipeline).
- Teste que captura o corpo da requisição e confirma que não há nome, telefone nem e-mail.
- Sem chave ou com a API fora do ar, o bot segue só com os parsers, repergunta e o `/health` acusa o LLM degradado.
- Stack padrão sobe sem Ollama e fica em ≤ 2,5 GB de RAM medidos; o resultado vai para `docs/fases/fase-11b.md`, com a decisão sobre juntar os bancos (D5) se a medição pedir.

**Depende de:** Fase 11 (para medir a stack já com site e painel, a medição final é refeita na Fase 16).

## Fase 12 — Conversa v2
**Entrega:**
- Estados novos:
  - `CONTACT_CONFIRM` (início pelo formulário, *double opt-in*);
  - `DEVELOPMENT` (início pelo WhatsApp);
  - `PAYMENT_MODE` e os ramos dos 3 modos (`CASH_OFFER`, `DOWN_CASH`, `CASH_NOW`, `DESIRED_INSTALLMENT`, `BALLOONS`).
- Resultado e menu de ajustes por modo.
- Textos lidos do `FlowConfig` publicado, com fallback para `templates.ts`. Etapas opcionais respeitam as chaves de liga e desliga.
- Revisão do tom das mensagens (ajustes.txt item 4, Prompt Guide Parte C).
- `sendButtons` no `ChannelAdapter`, se a Fase 9 aprovar.
- Casamento do lead por telefone ou código `ELV-xxxx`.
- Dossiê, PDF, CRM simulado e card do corretor com o modo e o plano da entrada.
- Suíte de regressão do `extraction.v3` (criado na Fase 11b) estendida com casos dos 3 modos de pagamento.

**Aceite:**
- Testes da máquina de estados para os 3 modos ponta a ponta, com canal falso.
- "Não" no `CONTACT_CONFIRM` encerra e não envia mais nada.
- Lead do formulário não recebe pergunta de consentimento, nome nem telefone.
- Todo número nas mensagens vem do motor (teste existente estendido).
- Handoff e exclusão continuam valendo em todos os estados novos.

## Fase 13 — Site de vendas e primeiro contato
**Entrega:**
- `apps/site` (Next.js) com a identidade Elevare migrada de `elevare-construtora/`: home, página por empreendimento com dados e preço "a partir de" vindos do banco, plantas e galeria.
- Formulário "Simule sua condição": nome, WhatsApp, e-mail opcional, empreendimento, tipologia, consentimento e opt-in, ambos desmarcados.
- Validação com Zod no servidor, honeypot, tempo mínimo de preenchimento e rate limit por IP e por telefone. Captura de UTM.
- Server Action cria ou atualiza o lead (sem duplicar pelo telefone) + `Consent` (WEB) + job `FIRST_CONTACT`.
- Página de obrigado com botão `wa.me` e o código do lead.
- Delivery worker envia o 1º contato com janela de horário, limite/hora e allowlist do piloto.
- `packages/ui` com os tokens Elevare.

**Aceite:**
- Formulário → mensagem no WhatsApp em ≤ 1 min (horário comercial).
- Reenviar o formulário não duplica o lead nem a mensagem.
- WA-AKG fora → o job reenvia quando o WA-AKG volta.
- Spam bloqueado nos testes.
- Lighthouse ≥ 90 em acessibilidade e performance no mobile.
- Nenhum dado pessoal ou segredo no bundle do cliente.

**Paralelo:** pode rodar junto com a Fase 14 depois da 11.

## Fase 14 — Painel I: base, cadastros e motor
**Entrega:**
- `apps/painel` (Next.js + shadcn): login, sessão, papéis e layout.
- **Empreendimentos e unidades:** CRUD, preço, status (disponível, reservada, vendida) e "publicar no site".
- **Condições comerciais:** formulário por empreendimento, rascunho → publicar com vigência, histórico e diff entre versões, e uma **calculadora de prévia** ao lado (escolhe a unidade e um perfil de exemplo e mostra o plano dos 3 modos usando o motor real).
- **Financiamento simulado:** página que edita a linha usada na estimativa do saldo (taxa, prazo, sistema, comprometimento). Por baixo, cria uma nova `ParameterSet`.
- **Corretores:** CRUD, ativo/inativo e telefone.
- **Auditoria:** lista filtrável.

**Aceite:**
- Rotas protegidas por papel (testes).
- Alterar uma condição no painel muda a próxima simulação do bot sem deploy.
- A prévia do painel bate exatamente com o cálculo do bot para a mesma entrada.
- Toda alteração aparece na auditoria com o usuário.

## Fase 15 — Painel II: leads e fluxo do bot
**Entrega:**
- **Leads:**
  - lista com filtros (empreendimento, modo, parecer, status, corretor, origem);
  - detalhe com a conversa, as simulações, o plano, o PDF, o consentimento e o histórico de status;
  - atribuir ou trocar o corretor;
  - assumir ou devolver o handoff;
  - pedir a exclusão.
- **Início:** funil formulário → contato confirmado → simulação → corretor, divisão por modo e leads do dia.
- **Fluxo do bot:**
  - editor por etapa (texto com variáveis, botões, liga/desliga das etapas opcionais), com blocos legais travados e linter;
  - rascunho → publicar → reverter;
  - mensagem de 1º contato editável.
- **Simulador de conversa:** chat no painel que roda o rascunho ou a versão publicada sem WhatsApp, mostrando o estado e os dados coletados ao lado.
- **Status do WhatsApp:** sessão conectada ou não, pela API do WA-AKG.

**Aceite:**
- Editar e publicar um texto muda a próxima mensagem do bot.
- Reverter volta à versão anterior.
- Texto com variável inválida ou palavra proibida não publica.
- O simulador percorre os 3 modos.
- Corretor vê só os próprios leads.

## Fase 16 — Endurecimento, deploy e roteiro de demo
**Entrega:**
- Playwright ponta a ponta: site → formulário → canal falso → bot → painel (lead com plano). Roteiros dos 3 modos.
- Revisão de segurança (`/security-review`) e correções. Headers e CSP. Backup do banco.
- Deploy na VPS de 4 GB (D14): Compose + Caddy + domínio + TLS, imagens vindas de um registry, limites de memória e swap. Variáveis em `.env` e runbook v2.
- **Medição final de memória e CPU** com a stack completa (site, painel, bot, WA-AKG, bancos) sob a carga da demo, registrada no relatório.
- **Roteiro de demonstração** para o cliente (personas prontas para cada modo, ordem das telas, plano B pelo simulador se o WhatsApp falhar).
- `demo-reset` antes de cada apresentação.

**Aceite:**
- Ponta a ponta verde.
- Nenhum achado alto aberto na revisão de segurança.
- Demo ensaiada do começo ao fim no ambiente publicado, nos dois caminhos (WhatsApp real e simulador).

## Ordem e dependências
`9 ∥ 10 → 11 → 11b → 12 → (13 ∥ 14) → 15 → 16`

- A 10 independe de canal e de banco.
- A 11b vem antes da 12 porque o prompt `extraction.v3` e o provedor de LLM definem como os testes da conversa v2 rodam.
- A 13 e a 14 só dependem da 11 (e a 13 também da 12, para o 1º contato).
- A 15 depende da 12 (fluxo lendo o `FlowConfig`) e da 14 (base do painel).

## Pendências externas (não bloqueiam as Fases 9–11)
- Regras reais da entrada parcelada da construtora (D9): % de entrada, ato, máximo de parcelas, reforços, INCC e juros, limite de comprometimento.
- Texto jurídico do consentimento web e do opt-in.
- Domínio e VPS para a demo (D12, D14).
- Chave da API da Anthropic para o bot (a partir da Fase 11b) e confirmação dos termos de retenção e treinamento da conta.
- Fotos e materiais reais dos empreendimentos (se houver; senão, ficam os SVG atuais).
