STATUS: PARCIAL. Código, testes e medições locais feitos (`pnpm check` verde: 706 testes). **Não foi testado no WhatsApp real** (sem aparelho): o envio do 1º contato foi validado com canal falso, e o Lighthouse foi medido pela CLI contra o build de produção local, não contra um deploy.

# Fase 13 — Site de vendas e primeiro contato

**Resumo:** o `apps/site` (Next.js) mostra os três empreendimentos Elevare com preço "a partir de" vindo do banco, recebe o formulário "Simule sua condição" e grava lead, consentimentos WEB e o job `FIRST_CONTACT`. O worker de entrega manda a 1ª mensagem no WhatsApp respeitando janela de horário, limite por hora e a lista de permitidos do piloto.

## O que foi feito

### `packages/ui` ([packages/ui](../../packages/ui))
Tokens Elevare (`tokens.css` e `tokens.ts`) e a base de estilos (reset, tipografia, botões, campos), migrados de `elevare-construtora/css/style.css`. Testes: o CSS e o TS não divergem e os pares de cor usados no site passam WCAG AA (4,5:1).

### Banco ([packages/db](../../packages/db))
- [site-leads.ts](../../packages/db/src/site-leads.ts):
  - `submitSiteLead` cria ou atualiza o lead **pelo telefone** (nunca duplica), grava dois `Consent` WEB (privacidade `web-1` e opt-in de WhatsApp `web-optin-1`, cada um com o texto exato em `text_snapshot`), o código `ELV-xxxx` e o job `FIRST_CONTACT` (a chave de deduplicação impede o segundo). Quem já conversou no WhatsApp mantém a origem; a UTM guarda a do 1º envio.
  - `listPublishedDevelopments` / `getPublishedDevelopment`: só empreendimentos `published` e ativos, com tipologias, metragens e o preço "a partir de" (menor entre as unidades **disponíveis**).
- [site-entry.ts](../../packages/db/src/site-entry.ts) (`@mvp/db/site`): entrada enxuta para o Next, sem o motor nem o hash nativo de senha.
- `deferJob`: adia o job sem gastar tentativa. `FIRST_CONTACT` passou a ser reservado por padrão pelo worker.

### Bot ([apps/bot](../../apps/bot))
- [first-contact.ts](../../apps/bot/src/first-contact.ts): o handler do `FIRST_CONTACT`.
  - **Janela de horário** ([business-hours.ts](../../apps/bot/src/lib/business-hours.ts)): padrão seg–sáb, 08:00–20:00, `America/Sao_Paulo`. Fora dela o job espera a abertura (não é falha e não gasta tentativa).
  - **Limite por hora** (padrão 30): o excedente espera a vaga abrir.
  - **Lista de permitidos**: número fora dela vira `DEAD` com o motivo; nada é enviado.
  - **Quem não deve receber**: lead que já conversou, parou, foi encerrado ou revogou o consentimento é pulado (auditoria `first_contact_skipped`).
  - **WA-AKG fora do ar**: o job é reagendado a cada 60 s, sem gastar tentativas, e envia quando o canal volta. Só desiste quando o pedido tem mais de 24 h.
  - **Sem duplicar**: depois de enviar, o job guarda `sent` no payload; uma nova tentativa não repete a mensagem.
  - Texto: `FlowConfig.firstContact` publicado, ou o padrão de `templates`.
- Variáveis novas (todas opcionais): `FIRST_CONTACT_START`, `_END`, `_DAYS`, `_TIMEZONE`, `_MAX_PER_HOUR` (documentadas em `infra/.env.example`).

### Site ([apps/site](../../apps/site))
- Home, página por empreendimento (dados, preço "a partir de", tabela de plantas e preços, plantas e galeria), página de obrigado, privacidade e 404. Identidade Elevare migrada; imagens PNG copiadas para `public/`.
- **Formulário** (Server Action): nome, WhatsApp, e-mail opcional, empreendimento, tipologia, consentimento e opt-in, ambos desmarcados e obrigatórios.
- **Validação e anti-spam** ([submit.ts](../../apps/site/src/lib/submit.ts)): Zod no servidor; honeypot (responde como sucesso e não grava); tempo mínimo de 3 s medido por um token assinado (HMAC); limite de 10 envios/hora por IP e 3/hora por telefone; UTM capturada da URL (guardada na sessão para sobreviver à navegação).
- **Obrigado**: botão `wa.me` com o código do lead no texto (cobre a resposta que vem como `@lid`). Sem dado pessoal na URL, só o código.
- Cabeçalhos de segurança básicos. `scripts/check-bundle.mjs` varre o que vai ao navegador atrás de segredos, string de conexão, cliente do banco e telefones.

## Medições

- **Lighthouse (mobile, CLI 12, build de produção local, banco local):**

| Página | Performance | Acessibilidade |
|---|---|---|
| Home | 97 | 100 |
| Empreendimento (Parc Verde) | 98 | 100 |
| Obrigado | 98 | 100 |

  Melhor-práticas 100 e SEO 100 nas duas páginas em que foram medidos. Um primeiro run apontou ordem de títulos e alvos de toque; corrigidos (títulos do rodapé em `h2`).
- **Bundle do cliente:** `check-bundle` limpo (18 arquivos).
- **Teste manual do envio** contra o build local: 1º envio → `303 /obrigado?c=ELV-…`; reenvio → mesmo código, **1 lead, 2 consentimentos, 1 job**; honeypot → sucesso falso sem gravar; preenchimento instantâneo → barrado; sem consentimento → erro por campo.

## Aceite

| Critério | Resultado |
|---|---|
| Formulário → mensagem no WhatsApp em ≤ 1 min (horário comercial) | Passa com canal falso (teste `phase13`). **Falta confirmar no aparelho.** |
| Reenviar não duplica lead nem mensagem | Passa (db, site e bot). |
| WA-AKG fora → reenvia quando volta | Passa (6 falhas seguidas, mais que as tentativas do job; envia uma vez). |
| Spam bloqueado nos testes | Passa (honeypot, tempo, IP, telefone, token forjado). |
| Lighthouse ≥ 90 (acessibilidade e performance, mobile) | Passa nas 3 páginas medidas. |
| Nenhum dado pessoal ou segredo no bundle do cliente | Passa (`check-bundle`). |

## Decisões

1. **Rate limit em memória.** O site roda numa instância só no piloto; com mais de uma, trocar por Redis ou tabela (`FormSubmission` do impactos §3, opcional). O IP vem de `X-Forwarded-For` só com `SITE_TRUST_PROXY=true` (usa o último item, o do nosso proxy).
2. **Opt-in e consentimento obrigatórios.** Sem o opt-in o bot não pode escrever primeiro; por isso as duas caixas barram o envio.
3. **A tipologia do formulário vai no payload do job**, mas o bot ainda a pergunta (`INTEREST`) depois do "sim" (decisão 4 da Fase 12). Pular a pergunta é ligar `typology` no `formSnapshot`; ficou fora para não mexer na máquina de estados nesta fase.
4. **Sem CSP.** O Next injeta scripts inline; uma CSP com nonce fica para a Fase 16 (hardening).
5. **Páginas dinâmicas** (`force-dynamic`): preço e status sempre frescos, sem rebuild; o custo é uma consulta por visita.

## Pendências

- Teste no WhatsApp real do fluxo completo (formulário → 1ª mensagem → "sim"), com o número dedicado.
- Textos legais do formulário e da página de privacidade seguem `RASCUNHO` (revisão jurídica).
- Lighthouse contra um deploy real (rede e CDN mudam LCP).
- Dockerfile e serviço no compose do `apps/site` (entram com a medição final da Fase 16). Para rodar: `SITE_DATABASE_URL`, `SITE_FORM_SECRET` (≥ 16 caracteres, obrigatória em produção), `SITE_WHATSAPP_NUMBER`, `pnpm --filter @mvp/site build && pnpm --filter @mvp/site start` (porta 3200).
- Captcha (Turnstile) só se aparecer abuso, como previsto no impactos §5.

## Testes

`pnpm check` verde: lint, typecheck (bot + site) e 706 testes (eram 664). Novos: `site-leads` (6), `jobs-brokers` (+1), `business-hours` (6), `phase13` (9, bot), `site` (18), `ui` (2).
