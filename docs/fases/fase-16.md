STATUS: PARCIAL por decisão do usuário. **Feito:** e2e Playwright, revisão de segurança com correções, CSP e cabeçalhos, backup e restauração do banco, medição de memória (parcial, ver limites), roteiro de demo e runbook v2, `demo-reset` endurecido. **Fora desta fase (o usuário resolve depois):** deploy na VPS (Compose, Caddy, domínio, TLS, registry, swap, `.env` de produção), medição em Docker na VPS e o ensaio da demo no ambiente publicado. `pnpm check` verde (799 testes) e `pnpm test:e2e` verde (10 testes).

# Fase 16 — Endurecimento, deploy e roteiro de demo

**Resumo:** a jornada completa (site → formulário → WhatsApp falso → bot → painel) passou a ter teste automatizado nos 3 modos de pagamento; o site e o painel ganharam CSP com nonce; a revisão de segurança achou e corrigiu 2 problemas médios e 1 de build do bot; há backup/restauração testados, roteiro de demo e runbook v2.

## O que foi feito

- **E2E** ([e2e/](../../e2e/), `pnpm test:e2e`): sobe sem Docker e sem tocar no seu banco um Postgres descartável, o bot (bundle esbuild, o mesmo da imagem), o site e o painel (builds de produção) e um WA-AKG falso. Roteiros (cada um com navegador real): modos 1, 2 e 3 do formulário do site até o lead com plano e PDF no painel e o aviso ao corretor; cabeçalhos e CSP; rotas do painel sem sessão e login errado; status do WhatsApp (e a chave da API não vai ao HTML); honeypot; reenvio do formulário sem duplicar lead nem mensagem; WA-AKG fora (o 1º contato sai quando volta); carga de 20 conversas × 20 mensagens com o painel e o site em uso. Falha se houver violação de CSP no console. Roda também o `check-bundle` do site (nenhum dado pessoal ou segredo no bundle do cliente).
- **CSP e cabeçalhos** ([csp.ts](../../packages/ui/src/csp.ts), `proxy.ts` do site e do painel): nonce por requisição, sem `unsafe-inline`/`unsafe-eval` em scripts em produção, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`/`form-action 'self'`; mais HSTS e COOP. `style-src-attr 'unsafe-inline'` fica liberado só para atributos `style=""` do React.
- **Backup** ([backup-db.sh](../../infra/scripts/backup-db.sh), [restore-db.sh](../../infra/scripts/restore-db.sh)): `pg_dump -Fc` validado com `pg_restore -l`, cifra opcional com `age`, retenção por `--keep`. Testado de verdade num Postgres do Compose descartável: backup → apagar `units` → restaurar → 14 linhas de volta; retenção manteve só os 2 mais novos.
- **Roteiro de demo** ([05-roteiro-demo.md](../v2/05-roteiro-demo.md)) e **runbook v2** ([06-runbook.md](../v2/06-runbook.md)).

## Revisão de segurança

Feita manualmente sobre o código (não rodei o `/security-review`: ele revisa só o diff pendente, e o código novo da fase é pequeno; a revisão cobriu o que já existia). Cobertura: autenticação e sessão, autorização do painel, formulário do site, webhook do bot, SQL, XSS, vazamento de segredo, cabeçalhos.

**Nenhum achado alto aberto.**

| Achado | Gravidade | Situação |
|---|---|---|
| O bundle do bot (`pnpm build` e, portanto, a imagem Docker) **não compilava** desde a Fase 14: o `@node-rs/argon2` (nativo) entrou pelo `@mvp/db` | Média (bloqueia o deploy) | **Corrigido**: import dinâmico no `users.ts` e `--external` no esbuild. Achado pelo e2e. |
| `demo-reset` rodava com `APP_ENV` vazio; produção usa as mesmas credenciais do banco | Média | **Corrigido**: o script exige `APP_ENV=demo\|development\|test`. |
| Sessões vencidas do painel nunca eram apagadas (`purgeExpiredSessions` sem chamador) | Baixa | **Corrigido**: roda junto da retenção do bot (teste novo). |
| Sem CSP, HSTS nem COOP | Média | **Corrigido** (acima). |
| Limites por IP (login, formulário) caem num balde único sem proxy configurado: um visitante esgota o limite de todos | Média (operação) | **Aberto, documentado**: ligar `SITE_TRUST_PROXY` e `PANEL_TRUST_PROXY` no deploy (runbook). |
| Após 5 erros a conta bloqueia por 15 min: permite bloquear de propósito o admin e revela que o e-mail existe (mensagem "muitas tentativas" × "incorretos") | Baixa | **Aberto**: aceitável para a demo; para produção, bloquear por (conta, IP) ou usar atraso crescente. |
| Limitadores em memória (um processo) | Baixa | **Aberto**: ok para uma instância. |
| `/health/deps` sem autenticação | Baixa | **Aberto, documentado**: o proxy só deve expor `/webhooks/wa-akg`. |
| WA-AKG no Compose com Swagger ligado e CA de desenvolvimento | Média (só no deploy) | **Aberto**: faz parte do deploy. |

Verificado e sem problema: SQL só por Prisma e `$queryRaw` com template parametrizado (a única query dinâmica, no `demo-reset`, usa nomes vindos do catálogo do Postgres e é travada acima); toda ação e todo serviço do painel confere permissão no servidor, o PDF confere o escopo do lead; assinatura HMAC do webhook em tempo constante; senha argon2id, sessão por token com hash, cookie `HttpOnly`/`SameSite=Lax`/`Secure`; nome do PDF sanitizado; nenhum `dangerouslySetInnerHTML`.

## Medição de memória (parcial)

Rodei site, painel e bot (bundle, com `--max-old-space-size=160`) e Postgres sem Docker, no macOS, durante o e2e (3 jornadas completas e a carga de 400 mensagens com navegação no painel e no site). RSS da árvore de processos, em MiB:

| Processo | Ocioso | Pico |
|---|---|---|
| bot | 284 | 297 |
| site | 227 | 242 |
| painel | 140 | 398 |
| Postgres (padrão, sem os ajustes do Compose) | 74 | 229 |

**Estimativa da stack completa:** somando bot + site + painel desta medição (≈ 940 MiB) aos containers do WA-AKG, do MySQL e do Postgres medidos em Docker na Fase 11b (≈ 440 MiB sem o bot) dá **cerca de 1,4 GB de pico**, dentro do teto de 2,5 GB.

Limites, para ninguém ler isto como o número final:
1. macOS, não Docker/Linux. O RSS do Node no macOS é maior que no container (na 11b o bot mediu 193 MiB; aqui 297). Para site e painel o número é um teto razoável, mas não é o do container.
2. WA-AKG e MySQL não rodaram aqui; usei os números da Fase 11b.
3. Sem Dockerfile de site e painel (parte do deploy), então não há `docker stats` da stack completa. **Refazer na VPS com `measure-memory.sh`.**
4. Sem LLM real e sem sessão de WhatsApp real. O painel teve o maior pico (≈ 400 MiB: PDF, páginas e hash argon2 de 19 MiB); sugiro `mem_limit` de 512m para ele e 384m para o site.

## Aceite

| Critério | Resultado |
|---|---|
| Ponta a ponta verde | **Passa** (10 testes, ~2,5 min). |
| Nenhum achado alto aberto na revisão de segurança | **Passa** (tabela acima). |
| Demo ensaiada no ambiente publicado, nos dois caminhos | **Não feito**: depende do deploy. O roteiro e o plano B existem; o caminho pelo simulador e o do canal falso foram exercitados só localmente. |

## Pendências

- **Deploy** (o usuário resolve): Dockerfile e serviço de site e painel, Caddy, domínio, TLS, registry, swap, `.env` de produção, medição em Docker na VPS, ensaio da demo publicada. Lista no [runbook](../v2/06-runbook.md#pendente-não-feito-na-fase-16-por-decisão-do-usuário).
- A imagem Docker do bot **não foi reconstruída** nesta fase (só o bundle esbuild que ela usa). Reconstrua no deploy.
- Gestão de usuários do painel (criar corretor/gerente pela tela) segue pendente desde a Fase 14; por isso o roteiro da demo não inclui entrar como corretor.
- Backup do MySQL do WA-AKG não tem script.
- Testes não tocam a Anthropic: os roteiros rodam só com os parsers (`LLM_ENABLED=false`). A bateria de acerto do `extraction.v3` segue em aberto desde a 11b.

## Testes

Novos: `csp` (3), retenção de sessões (1), e2e Playwright (10). De 795 para 799 no Vitest.
