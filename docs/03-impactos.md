# 03 — Impactos

Decisões aprovadas (2026-10-26):

| # | Decisão |
|---|---|
| D1 | WA-AKG (Baileys) **somente no MVP/piloto**, atrás de um adaptador de canal. |
| D2 | Orquestrador em **Node.js + TypeScript**. |
| D3 | **LLM local leve**, bem promptado (via Ollama, API local). |
| D4 | **CRM simulado** (adaptador + persistência/exportação local). |
| D5 | **PostgreSQL separado** do banco do WA-AKG. |

## 1. Impacto no spec.md

| Seção | Mudança |
|---|---|
| §1.5, §7.7 | "API oficial" vira "canal abstrato; MVP em WA-AKG (não oficial), produção em API oficial". |
| §1.4 | Adicionar fora de escopo do MVP: templates/janela 24h, painel admin completo, agenda, PDF com identidade final. |
| §9.1 | Gateway de canais com `ChannelAdapter` (`WaAkgAdapter` agora, `CloudApiAdapter` depois). Adicionar fila de entrada. |
| §9.2 | LLM local: **parsers determinísticos primeiro**, LLM só como fallback de extração e para FAQ. |
| §9.3 | Backend Node/TS (Fastify), Postgres, fila em Postgres (sem Redis no MVP), Ollama. |
| §11 | CRM = adaptador `SimulatedCrm`. Agenda e analytics fora do MVP. |
| §14 | Fase 1 = piloto controlado, número dedicado, leads com opt-in, volume baixo. |
| §15 | Novos riscos: ban/ToS (alto), LLM local fraco em extração (médio), perda de webhook (alto). |
| §7.1 | Metas de desempenho: p95 ≤ 3 s e 500 conversas simultâneas **não valem para o MVP** (LLM local). Ajustar para metas realistas medidas na Fase de testes. |

## 2. Impacto na arquitetura

```
WhatsApp ⇄ WA-AKG ──webhook assinado──▶ [Ingress] ─▶ fila (Postgres) ─▶ [Orquestrador]
                ▲                                                         │  máquina de estados
                └────── ChannelAdapter.send ◀───────────────────────────  │  parsers + LLM (Ollama)
                                                                          ├─ Motor de simulação (puro, testado)
                                                                          ├─ Score
                                                                          └─ Dossiê/PDF ─▶ SimulatedCrm + notificação corretor
```

- **Ingress** só valida assinatura, grava e responde 200 (nunca perde mensagem por LLM lento).
- **Idempotência** por `message.key.id` (WA-AKG pode reentregar).
- **Ignorar**: `fromMe`, grupos, eventos que não são `message.received`.
- **Identidade do lead**: telefone normalizado a partir de `remoteJidAlt`/JID; tratar LID.
- **Motor de simulação**: pacote puro, sem I/O, parâmetros injetados → testável contra planilha do financeiro.
- **Parâmetros financeiros**: tabelas com vigência no Postgres; no MVP editadas por seed/CLI (painel fica para depois).

## 3. Impacto do LLM local

| Efeito | Mitigação |
|---|---|
| Modelo pequeno erra JSON e valores | Parsers regex/gramática para dinheiro, sim/não, datas, listas; LLM só se parser falhar; saída com schema (`format` do Ollama) + validação Zod; falha → repergunta. |
| Latência maior que 3 s | Indicador "digitando…" (`presence`), respostas do fluxo são templates fixos (sem LLM), LLM só no fallback e FAQ. |
| Pouca concorrência | Fila com concorrência limitada; MVP dimensionado para dezenas de conversas, não 500. |
| Alucinação em FAQ | FAQ por busca em base cadastrada; LLM só reescreve trecho recuperado; sem trecho → "vou confirmar com o corretor". |
| Português BR | Escolher modelo na Fase 0 por **bateria de testes** (Qwen2.5 / Llama 3.x / Gemma, 3B–8B), não por preferência. |
| Hardware | Rodar Ollama local/servidor; requisito de RAM definido pelo modelo escolhido `[a medir]`. |
| Interface | `LlmClient` abstrato → trocar por API em nuvem depois sem mexer no fluxo. |

## 4. Impacto no WA-AKG

- Rodar via Docker Compose **isolado** (rede própria), com o MySQL/Postgres dele separado do nosso.
- Número WhatsApp **dedicado ao piloto**; sem broadcast em massa.
- Gerar API key e webhook com `secret`; guardar em `.env`.
- Mensagens também ficam no banco do WA-AKG → incluir na política de retenção/exclusão LGPD.
- Botões interativos podem não renderizar `[verificar em teste real]` → o fluxo usa **texto numerado** como padrão ("1 - Sim, 2 - Não").
- Não modificar o código do WA-AKG; só consumir API/webhook.

## 5. Impacto em LGPD / jurídico

- Consentimento é a primeira etapa; guardar texto versionado, data, canal.
- Texto jurídico real do consentimento e avisos legais **não existe ainda** → usar texto provisório marcado `RASCUNHO`, bloquear produção até aprovação.
- Exclusão de dados (RF-10) deve apagar no nosso banco **e** no WA-AKG (via API/DB).
- Logs com mascaramento de telefone/renda.

## 6. Impacto em esforço e escopo (MVP)

**Dentro:** RF-01 a RF-05, RF-07, RF-10 a RF-16, RF-17 a RF-21, RF-24, RF-31, RF-33 (via CRM simulado), RF-36 (simplificado), RF-43; PDF simples; parâmetros por seed.
**Fora:** RF-06 completo (FAQ mínimo), RF-22 detalhado, RF-23 simplificado (fluxo de obra por empreendimento via seed), RF-25–RF-30 (cenários e score → versão simples/fase 2), RF-38–RF-52 (distribuição avançada, painéis, perfis, auditoria avançada), RF-42/RF-44 (follow-up automático — risco de ban).
**Cadência:** estimativa em fases pequenas (ver plano), cada uma verificável isoladamente.

## 7. Riscos novos ou elevados

| Risco | Nível | Resposta |
|---|---|---|
| Ban do número / ToS | Alto | Piloto restrito, número dedicado, sem outbound frio, adaptador para migrar. |
| Perda de mensagem por webhook sem retry | Alto | Ingress mínimo + fila + checagem de logs de entrega do WA-AKG. |
| LLM local errar dados financeiros | Alto | Confirmação explícita de valores-chave antes de calcular (spec §5.1). |
| Regras de crédito sem validação do financeiro | Alto | Parâmetros de exemplo marcados `ILUSTRATIVO`; aviso em toda simulação. |
| Dívida técnica por CRM simulado | Médio | Interface `CrmAdapter` estável; contrato testado. |
