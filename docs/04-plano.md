# 04 — Plano fase a fase

Regra: uma fase por vez. Só avança com critério de aceite verde e aprovação do usuário.
Stack: Node.js + TypeScript (Fastify), PostgreSQL (Prisma), Vitest, Zod, Ollama, WA-AKG via Docker.
Estrutura alvo: monorepo `apps/bot` (ingress + orquestrador), `packages/simulation` (motor puro), `packages/channel`, `packages/llm`, `packages/crm`, `infra/` (docker compose), `prompts/`, `docs/`.

## Fase 0 — Fundação e ambiente
**Entrega:** monorepo TS, lint/test, `infra/docker-compose` com WA-AKG (isolado) + Postgres nosso + Ollama; `.env.example`; spec.md ajustado conforme `03-impactos.md` §1; sessão WA-AKG conectada a número de teste.
**Aceite:** `docker compose up` sobe tudo; WA-AKG envia webhook de teste (`/webhooks/.../test`) para um endpoint nosso e a assinatura HMAC é validada; Ollama responde.
**Verificar:** botões renderizam? formato real do `message.received` e do LID.

## Fase 1 — Motor de simulação (puro)
**Entrega:** `packages/simulation`: Price, SAC, comprometimento de renda, valor financiável, entrada necessária, seguros/taxa adm, limite por idade, enquadramento por linha, FGTS na entrada, parecer (viável / ajustes / inviável), fluxo de obra simples. Parâmetros injetados (sem hardcode). Seed de parâmetros `ILUSTRATIVO`.
**Aceite:** testes unitários com casos de referência (planilha calculada à parte) para SAC e Price; casos de borda (parcela_max ≤ 0, idade, cota); cálculo < 1 s.
**Depende de:** nada externo → pode ser validado pelo financeiro isoladamente.

## Fase 2 — Dados e parâmetros
**Entrega:** schema Prisma (Lead, Consentimento, Conversa, PerfilFinanceiro, Empreendimento, Unidade, Simulacao, LinhaCredito, Corretor, LogAuditoria, MensagemProcessada); migrations; seed (1 empreendimento, unidades, linhas, 2 corretores); repositório de parâmetros com **vigência**; CLI para alterar parâmetros com registro em auditoria.
**Aceite:** simulação lê parâmetros vigentes na data; alteração via CLI gera histórico; simulação grava `parametros_versao`.

## Fase 3 — Canal: ingress, fila e envio
**Entrega:** `ChannelAdapter` + `WaAkgAdapter` (send texto/lista/PDF, presence, read); endpoint de webhook com validação HMAC, filtro (`fromMe`, grupo, evento), idempotência por id, gravação em fila Postgres, worker com reprocessamento.
**Aceite:** mensagem real do WhatsApp chega, é gravada e processada uma única vez mesmo com reentrega; derrubar o worker e subir de novo não perde mensagem; resposta de eco enviada com "digitando…".

## Fase 4 — Camada de linguagem (parsers + LLM local)
**Entrega:** parsers determinísticos (dinheiro "5k/uns 5 mil/R$ 5.000", sim/não, data, nome, telefone, e-mail, opções numeradas, "voltar/corrigir/sair/corretor"); `LlmClient` (Ollama) com saída JSON validada por Zod; prompts versionados em `prompts/`; suíte de regressão; **bateria de comparação de modelos** em PT-BR e escolha do modelo.
**Aceite:** parsers ≥ 95% nos casos do conjunto de teste; LLM fallback ≥ meta definida na bateria; injeção de prompt ignorada; modelo escolhido documentado com latência medida.

## Fase 5 — Orquestrador e fluxo de coleta
**Entrega:** máquina de estados do spec §5 (saudação → consentimento LGPD → identificação → interesse → perfil → co-proponente → entrada/FGTS → elegibilidade → confirmação), uma pergunta por vez, persistência por etapa, correção/voltar, retomada (7 dias), opt-out, detecção de handoff/fora de escopo, mensagens como templates.
**Aceite:** conversa completa via WhatsApp real em ≤ 5 min; recusa de LGPD encerra sem coletar dado; nada de dado pessoal gravado antes do aceite; retomada após reinício do serviço.

## Fase 6 — Apresentação, dossiê e CRM simulado
**Entrega:** chamada ao motor, mensagem de resultado com avisos legais, ajuste de entrada/prazo com recálculo, dossiê (card de texto), PDF simples com aviso legal, `CrmAdapter` + `SimulatedCrm` (criar/atualizar sem duplicidade por telefone, anexar simulação, fila de reenvio), notificação ao corretor por WhatsApp, atribuição round-robin simples.
**Aceite:** corretor recebe card + PDF em ≤ 1 min; mesmo telefone não duplica lead; falha forçada do CRM enfileira e reenvia; nenhum número na mensagem vem do LLM (teste automatizado compara).

## Fase 7 — Handoff humano e LGPD
**Entrega:** "falar com corretor" em qualquer etapa com histórico repassado e bot silencioso; comando do corretor para assumir; fluxo de exclusão do titular (nosso banco + WA-AKG); retenção configurável; mascaramento em logs; consentimento versionado.
**Aceite:** handoff em todos os estados testado; exclusão remove dados e deixa registro mínimo auditável; logs sem telefone/renda em claro.

## Fase 8 — Endurecimento e piloto
**Entrega:** testes ponta a ponta com roteiros de leads (viável / ajustes / inviável / informal / injeção / áudio), observabilidade básica (logs estruturados por conversa), limites de concorrência, runbook, checklist de critérios de aceite do spec §13 (itens do MVP), lista do que falta para produção (API oficial, textos jurídicos, validação do financeiro).
**Aceite:** checklist do MVP verde; piloto com número dedicado e leads com opt-in.

## Pós-MVP (fora deste plano)
Score configurável, follow-up (após API oficial/templates), painel admin, distribuição avançada com SLA, CRM real, `CloudApiAdapter`.

## Ordem e dependências
`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`. As fases 1 e 4 podem rodar em paralelo à 3 se necessário, pois são independentes de canal.

## Pendências externas (não bloqueiam a Fase 0–1)
Planilha/casos de referência do financeiro · linhas e taxas reais · fluxo de obra do empreendimento · texto jurídico do consentimento · máquina com RAM suficiente para o modelo escolhido.
