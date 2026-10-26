# 02 — Discovery

Data: 2026-10-26. Fonte: README e `docs/API_DOCUMENTATION.md` do repositório WA-AKG (v1.7.0, MIT). Itens não confirmados estão marcados `[verificar]`.

## 1. O que o WA-AKG é (e não é)

Gateway WhatsApp self-hosted + dashboard. **Não é um chatbot com IA.** Seu "bot" é baseado em regras (auto-reply por palavra-chave, comandos). Toda a inteligência da conversa (estado, NLU, motor de simulação, score) precisa ser construída por nós, fora dele.

| Item | Fato |
|---|---|
| Engine WhatsApp | `@whiskeysockets/baileys` (**cliente não oficial**, conexão por QR code) |
| Stack | Next.js 16, TypeScript, Prisma, MySQL ou PostgreSQL |
| Deploy | PM2 ou `docker compose` (sobe MySQL + app) |
| Multi-sessão | Sim, vários números por QR |
| Auth da API | Header `X-API-Key` (`POST /user/api-key`); sem escopos documentados |
| Roles | SUPERADMIN, STAFF, USER |
| Docs da API | Swagger em `/docs`; 109+ endpoints |

## 2. Capacidades úteis para o nosso caso

- **Receber mensagens:** webhook `POST /webhooks/{sessionId}` com `name`, `url`, `secret?`, `events[]`. Evento `message.received` traz `data.key`, `from`, `sender`, `type`, `content`, `isGroup`, `quoted`.
- **Assinatura:** `X-Webhook-Signature: sha256=<hmac do corpo bruto>` quando há `secret`. Verificar sempre.
- **Eventos:** `message.received/sent/status/deleted/edited`, `connection.update`, `group.*`, `contact.update`, `status.update`, `*`.
- **Enviar texto:** `POST /messages/{sessionId}/{jid}/send` (`message.text`).
- **Botões/lista/enquete:** `/interactive`, `/list` (lista numerada), `/poll` (2–12 opções).
- **Enviar PDF:** `POST /messages/{sessionId}/{jid}/media`, multipart, `type=document`, `caption`.
- **UX de conversa:** `PUT /chat/.../read` (marcar lida) e `POST /chat/.../presence` (`composing`) — permitem "digitando…" natural.
- **Logs de entrega de webhook:** `GET /webhooks/{sessionId}/{id}/logs`.
- **n8n:** nós oficiais (`n8n-nodes-wa-akg`) — alternativa, mas não adotada por padrão (ver impactos).

## 3. Lacunas e riscos encontrados

| # | Achado | Gravidade |
|---|---|---|
| G1 | **Baileys é não oficial.** O spec §1.5 e §7.7 exigem **API oficial** (WhatsApp Business Platform), templates aprovados e opt-in. WA-AKG contradiz isso. Há risco real de banimento do número e de violação dos termos do WhatsApp. | **Crítica** |
| G2 | **Sem retry de webhook documentado.** Se nosso serviço estiver fora, a mensagem pode ser perdida. Spec §7.2 exige "nenhum lead perdido". `[verificar no código]` | Alta |
| G3 | Sem LLM/estado de conversa. Orquestrador é 100% nosso. | Esperada |
| G4 | Sem templates/janela de 24h (conceito da API oficial). Follow-up (RF-42) e reativação (RF-44) viram envio livre por número não oficial — maior risco de ban. | Alta |
| G5 | Botões interativos em Baileys podem não renderizar em todos os clientes `[verificar]`; planejar fallback para texto/lista numerada. | Média |
| G6 | API key sem escopos: chave vaza = acesso total às sessões. | Média |
| G7 | Rate limits não documentados; broadcast usa atraso aleatório (10–20 s). | Média |
| G8 | Áudio/imagem chegam como `type` diferente; spec v1 manda orientar a responder por texto — viável. | Baixa |
| G9 | Dados do WA-AKG (DB próprio) também terão mensagens com dados pessoais → entram no escopo LGPD (retenção, exclusão, criptografia em repouso). | Média |
| G10 | Janela de identificação: `jid` pode vir como LID e não como telefone (`remoteJidAlt`). Deduplicação por telefone (RF-41) precisa tratar isso. `[verificar]` | Média |

## 4. Ajustes propostos ao spec (para a etapa Impactos)

1. §1.5 e §7.7: trocar "WhatsApp Business API oficial" por **camada de canal abstrata**. v1/piloto roda em WA-AKG; produção recomendada migra para API oficial sem reescrever o orquestrador.
2. §9.1: gateway de canais ganha adaptador `WaAkgAdapter` (e futuro `CloudApiAdapter`).
3. §7.2: adicionar fila própria de entrada (webhook → persistir → processar) para compensar G2.
4. §15: incluir riscos de ban/ToS (G1, G4) como risco **alto**.
5. §14: Fase 1 passa a ser explicitamente "piloto controlado" (número dedicado, volume baixo, leads com opt-in).
6. §12: tratar mensagens de grupo (ignorar), `fromMe` (não reagir ao próprio envio) e LID.

## 5. Decisões que dependem do usuário

1. **Canal:** aceitar WA-AKG (não oficial) só para MVP/piloto, ou exigir API oficial desde já? *(recomendado: WA-AKG no piloto atrás de adaptador, migrar depois)*
2. **Linguagem do orquestrador:** Node/TypeScript (mesma stack do WA-AKG) ou Python/FastAPI? *(recomendado: TypeScript)*
3. **LLM:** provedor/modelo para extração e redação. *(sugestão: família Claude)*
4. **CRM** da construtora (spec §16.1) — define a Fase de integração; até lá, adaptador com CRM "mock" + export.
5. **Banco:** compartilhar o Postgres do WA-AKG ou instância separada? *(recomendado: separada, schema próprio)*
6. Respostas às questões abertas do spec §16 que travam o motor (linhas de crédito, taxas, fluxo de obra, texto jurídico do consentimento).

## 6. Próximo passo
Com as decisões acima (ou aceitando as recomendações), escrever `docs/03-impactos.md` e `docs/04-plano.md`.
