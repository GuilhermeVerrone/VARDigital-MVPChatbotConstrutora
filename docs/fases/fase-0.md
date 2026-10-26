STATUS: PARCIAL

# Fase 0 — Fundação e ambiente

Data: 2026-10-26. Executada em modo autônomo; não existiam relatórios de fases anteriores.

**Resumo:** os critérios de aceite automatizáveis passaram **em execução real** no Docker local: a stack sobe, o WA-AKG (`POST /api/webhooks/{session}/{id}/test`) entregou o webhook ao bot, a assinatura HMAC foi validada (200) e um secret errado foi rejeitado (401). O Ollama respondeu. O status é **PARCIAL** porque três itens dependem de algo que não estava disponível: (1) conectar a sessão do WA-AKG a um número de teste exige escanear o QR code; (2) por falta de disco, o Ollama **em container** não foi baixado (validei com o Ollama do host); (3) a renderização de botões e o formato real de `message.received` e do LID dependem de um número conectado.

## O que foi feito

1. **Monorepo TypeScript** com pnpm workspaces, ESLint (flat config + typescript-eslint), `tsc` (typecheck) e Vitest (projects).
   - `packages/channel`: `verifyWaAkgSignature` e `signWaAkgPayload`. Calculam o HMAC-SHA256 sobre o corpo **bruto** e comparam em tempo constante.
   - `apps/bot`: servidor Fastify com:
     - `POST /webhooks/wa-akg`: valida a assinatura **antes** de interpretar o JSON (401 se inválida), valida o envelope com Zod (400 se inválido) e responde 200 `{received:true}`.
     - `GET /health` e `GET /health/deps`: o segundo checa Postgres e Ollama de verdade.
     - HTTPS opcional, configuração validada por Zod e logs JSON com telefone mascarado. O conteúdo das mensagens não é logado.
     - Captura opcional de payloads brutos (`WEBHOOK_CAPTURE_DIR`, só para dev) para inspecionar o formato real.
   - O bot vira um bundle esbuild (`dist/main.cjs`) numa imagem Docker sem `node_modules`.
2. **`infra/docker-compose.yml`** (projeto `mvp-construtora`):
   - `wa-akg` + `wa-akg-db` (MySQL 8) numa rede própria (`wa-akg-internal`). A imagem é construída a partir de um clone fixo do WA-AKG v1.7.0 (commit `936b26b`, em `vendor/wa-akg`, não versionado e **não alterado**).
   - `bot` + `bot-db` (PostgreSQL 16, **separado**) na rede `bot-internal`.
   - `ollama` (perfil `ollama`, imagem `ollama/ollama:0.33.0`).
   - Rede `edge` (198.18.100.0/24): a única ponte entre o WA-AKG e o bot.
   - Portas expostas só em `127.0.0.1`.
3. **Scripts** em `infra/scripts/`:
   - `init-env.sh`: gera `infra/.env` com segredos aleatórios, `chmod 600`.
   - `gen-dev-certs.sh`: CA de dev + certificado do bot.
   - `fetch-wa-akg.sh`: clona o WA-AKG no commit fixo.
   - `wa-akg-bootstrap.sh`: idempotente. Faz login do admin via NextAuth, gera a API key (salva em `.env`), cria a sessão `piloto`, cria/atualiza o webhook com secret e dispara o teste.
   - `check-ollama.sh`: versão, modelos e geração em JSON.
   - `verify-phase0.sh`: roda todos os critérios automáticos.
4. **`.env.example`** em `infra/`. Nenhum segredo versionado; conferi com `git grep` dos valores reais de `infra/.env`.
5. **spec.md**: já estava na v1.1 com todos os ajustes da tabela de `03-impactos.md` §1 (§1.4, §1.5, §7.1, §7.7, §9.1–9.3, §11, §12, §14, §15). Acrescentei só o que esta fase confirmou:
   - §9.1: exigência de HTTPS e IP público para o webhook.
   - §7.2: o ingress precisa responder bem antes do timeout de 10 s.
   - §15: ausência de retry agora confirmada no código.
6. **docs/02-discovery.md** §7: fatos verificados no código do WA-AKG (ver abaixo).
7. READMEs: `README.md` (raiz), `infra/README.md` (setup, Ollama por sistema operacional, QR code, captura de payloads) e `prompts/README.md`.

### Commits (sem push)
```
cf98e69 document wa-akg webhook findings in spec and discovery
c60544c add docker compose stack with wa-akg, postgres, ollama and bot
f99bd85 scaffold ts monorepo with bot webhook endpoint
447e01f add project docs, spec and phase runner
```
(+ o commit deste relatório)

## Arquivos principais
- `apps/bot/src/routes/wa-akg-webhook.ts`, `apps/bot/src/server.ts`, `apps/bot/src/main.ts`, `apps/bot/src/config.ts`, `apps/bot/src/deps.ts`, `apps/bot/src/lib/mask.ts`, `apps/bot/Dockerfile`
- `packages/channel/src/webhook-signature.ts`
- `apps/bot/test/*.test.ts`, `packages/channel/test/webhook-signature.test.ts`
- `infra/docker-compose.yml`, `infra/.env.example`, `infra/scripts/*.sh`, `infra/README.md`
- `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.dockerignore`

## Decisões (tomadas pelas recomendações dos docs ou por necessidade técnica)

| # | Decisão | Motivo |
|---|---|---|
| F0-1 | **Achado novo: o WA-AKG só entrega webhook em `https://` para host com IP público.** No código, `validateSafeUrl(..., {allowHttp:false})` recusa `http`, `localhost` e IPs privados. Contorno de dev **sem alterar o WA-AKG**: (a) o bot serve TLS com uma CA local e o container do WA-AKG confia nela via `NODE_EXTRA_CA_CERTS` (variável de ambiente); (b) a rede `edge` usa 198.18.0.0/15 (RFC 2544, nunca roteada na internet, fora da lista bloqueada). | Era a única forma de fazer o WA-AKG entregar ao bot na rede Docker local. **Só para dev.** No piloto: domínio público com certificado válido. |
| F0-2 | Ollama: no macOS roda **no host** (`OLLAMA_BASE_URL=http://host.docker.internal:11434`); no Linux, container via `COMPOSE_PROFILES=ollama`. `init-env.sh` escolhe pelo sistema operacional. | No Mac o Docker não acessa a GPU/Metal. Além disso, a imagem tem 2,8 GB comprimida e o disco tinha ~5 GB livres. |
| F0-3 | Fastify serve HTTPS direto (sem proxy reverso em dev). | Uma imagem a menos; disco limitado. |
| F0-4 | Parser de corpo bruto só no escopo do webhook (plugin encapsulado). | O HMAC precisa dos bytes exatos; as outras rotas continuam com JSON normal (há teste para isso). |
| F0-5 | Bot empacotado com esbuild (CJS, ~2,4 MB) e imagem sem `node_modules`. | Imagem final de 246 MB, sem resolução de workspace em runtime. |
| F0-6 | TypeScript fixado em `~6.0.3`. | O typescript-eslint 8.72 não suporta TS 7 (o lint quebrava). |
| F0-7 | Commits direto em `main`, sem branch por fase. | O repositório não tinha commits, e o runner (`scripts/run-all-phases.sh`) executa as fases em sequência na mesma árvore; branches por fase ficariam sem merge. |
| F0-8 | Prisma **não** foi adicionado. O `/health/deps` usa `pg` (`select version()`). | O schema é escopo da Fase 2. |
| F0-9 | WA-AKG com `ENABLE_TELEMETRY=false`, `ENABLE_AUTO_UPDATE_CHECK=false`, `TZ=America/Sao_Paulo`. | Sem chamadas externas desnecessárias. |

## Resultados dos testes (saída real)

### `pnpm check` (lint + typecheck + testes)
```
> eslint .
> tsc -p tsconfig.json
> vitest run
 RUN  v5.0.5 /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
 Test Files  3 passed (3)
      Tests  30 passed (30)
   Start at  20:03:07
   Duration  208ms (import 56%, tests 31%, transform 9%, worker 3%)
```
(Lint e typecheck sem nenhuma mensagem de erro.)

### `vitest run --reporter=verbose`
```
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > aceita assinatura calculada como o WA-AKG calcula
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > aceita hex em maiúsculas
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita corpo alterado
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita secret errado
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita corpo re-serializado (assinatura vale só para o corpo bruto)
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header ausente
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header vazio
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header sem prefixo
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header prefixo errado
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header hex curto
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header não-hex
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > rejeita header array
 ✓ |channel| test/webhook-signature.test.ts > verifyWaAkgSignature > falha alto se o secret estiver vazio (erro de configuração)
 ✓ |bot| test/mask-config.test.ts > maskJid > mantém só os 4 últimos dígitos e o domínio
 ✓ |bot| test/mask-config.test.ts > maskJid > não vaza valores curtos
 ✓ |bot| test/mask-config.test.ts > maskJid > ignora valores não-string
 ✓ |bot| test/mask-config.test.ts > loadConfig > aplica defaults
 ✓ |bot| test/mask-config.test.ts > loadConfig > exige secret de webhook forte
 ✓ |bot| test/mask-config.test.ts > loadConfig > exige cert e key TLS juntos
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > aceita o webhook de teste do WA-AKG com assinatura válida
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > rejeita sem assinatura
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > rejeita assinatura com outro secret
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > rejeita corpo adulterado
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > valida assinatura antes de interpretar o JSON (corpo inválido sem assinatura → 401)
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > retorna 400 para JSON inválido com assinatura válida
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > retorna 400 para envelope sem campo event
 ✓ |bot| test/webhook.test.ts > POST /webhooks/wa-akg > aceita message.received e grava captura bruta quando habilitada
 ✓ |bot| test/webhook.test.ts > health > GET /health
 ✓ |bot| test/webhook.test.ts > health > GET /health/deps retorna 503 se alguma dependência falhar
 ✓ |bot| test/webhook.test.ts > health > outras rotas continuam aceitando JSON normal (parser bruto é só do webhook)
 Test Files  3 passed (3)
      Tests  30 passed (30)
```

### Aceite em execução: `./infra/scripts/verify-phase0.sh` (Docker Desktop 28.3.3, macOS, stack no ar)
```
### 1. Serviços do compose
SERVICE     STATUS
bot         Up About a minute (healthy)
bot-db      Up 4 minutes (healthy)
wa-akg      Up 4 minutes
wa-akg-db   Up 4 minutes (healthy)
PASS

### 2. Bot: /health/deps (Postgres + Ollama) via HTTPS
{"status":"ok","postgres":{"ok":true,"latencyMs":11,"detail":"PostgreSQL 16.15"},"ollama":{"ok":true,"latencyMs":32,"detail":"models: llama3.2:3b"}}
PASS

### 3. Bot recusa assinatura inválida (direto, sem WA-AKG)
HTTP 401
PASS

### 4. WA-AKG → POST /api/webhooks/{session}/{id}/test → bot valida HMAC

== Aguardando WA-AKG em http://localhost:3000

== Sessão 'piloto'
já existe

== Webhook → https://bot:3100/webhooks/wa-akg
já existe (<id>); atualizando secret/eventos
{"atualizado":true,"isActive":true,"events":["message.received","connection.update"]}

== Teste de entrega (WA-AKG → bot, assinado com HMAC)
{
  "status": true,
  "message": "Webhook test successful",
  "data": {
    "success": true,
    "statusCode": 200,
    "responseBody": "{\"received\":true}",
    "responseTimeMs": 7
  }
}
OK: o bot aceitou a assinatura (só responde 200 com HMAC válido).

== Próximo passo manual: conectar o número de teste
Abra http://localhost:3000/dashboard (login admin@piloto.local) → sessão 'piloto' → escaneie o QR code.
PASS

### 5. Ollama responde
== http://localhost:11434/api/version
{"version":"0.33.0"}
== modelos
llama3.2:3b
== geração (llama3.2:3b, format=json)
{
  "response": "{\"renda\": 5000}",
  "total_s": 0.247496791,
  "load_s": 0.009514833,
  "eval_count": 9
}
parede: 0 s
OK: Ollama respondeu JSON válido
PASS

FASE 0: todos os checks automáticos PASSARAM
```
Na primeira geração (modelo frio) foram `total_s: 4.57`, com `load_s: 4.04`.

### Teste negativo ponta a ponta (WA-AKG com secret errado → bot recusa)
Troquei o secret do webhook no WA-AKG (`PUT /api/webhooks/piloto/{id}`) e disparei o teste:
```
{"success":false,"statusCode":401,"responseBody":"{\"error\":\"invalid signature\"}","responseTimeMs":4,"error":"Returned 401: Unauthorized"}
```
Depois restaurei o secret com o `wa-akg-bootstrap.sh` (teste voltou a `success: true`). Logs do bot nesse ciclo (só tipo de evento, sem dados pessoais):
```
{"level":30,"msg":"webhook recebido","event":"test","sessionId":"test"}
{"level":40,"msg":"webhook rejeitado: assinatura inválida","hasSignature":true}
{"level":30,"msg":"webhook recebido","event":"test","sessionId":"test"}
```

### Bot dentro do Docker → Ollama do host
```
$ docker compose exec bot node -e "fetch(OLLAMA_BASE_URL+'/api/generate', ...)"
http://host.docker.internal:11434 {"ok": true} 0.22s
```

## Verificações sobre o WA-AKG (código v1.7.0)
Detalhes em `docs/02-discovery.md` §7.
- A API fica sob `/api/...`.
- Webhook só em HTTPS + IP público.
- Envelope `{event, sessionId, timestamp, data}`.
- Assinatura `sha256=<hex>` sobre `JSON.stringify` do envelope.
- **Sem retry**: uma tentativa, timeout de 10 s.
- `message.received` traz `key{id,remoteJid,fromMe,participant}`, `from`, `sender`, `isGroup`, `chatType`, `type` (em MAIÚSCULAS: `TEXT`, `AUDIO`…), `content`, `fileUrl`, `quoted`.
- Mensagens do próprio número saem como `message.sent`.
- LID: o WA-AKG normaliza `@lid` → telefone quando conhece `remoteJidAlt` ou o contato; senão o `@lid` chega como está.
- `/list` tem `legacyText: true`, que manda lista numerada em texto.

## O que ficou NÃO verificado e como o usuário valida

| Item | Por quê | Como validar |
|---|---|---|
| Sessão WA-AKG **conectada a número de teste** | Exige escanear o QR code no celular | `cd infra && docker compose up -d`; abrir http://localhost:3000/dashboard (credenciais em `infra/.env`: `WA_AKG_ADMIN_EMAIL`/`WA_AKG_ADMIN_PASSWORD`) → sessão `piloto` → escanear o QR com o **número dedicado ao piloto**. |
| Formato real do `message.received` e do LID | Precisa de número conectado | Em `infra/.env`: `WEBHOOK_CAPTURE_DIR=/captures`; depois `docker compose up -d bot`. Mande mensagens de outro celular (texto, áudio, e de um contato novo para cair em `@lid`) e rode `docker compose exec bot sh -c 'cat /captures/*'`. Depois apague as capturas (**contêm dados pessoais**) e desligue a variável. Os logs do bot já mostram `from`, `type`, `isGroup` e `fromMe` mascarados. |
| Botões/lista renderizam? | Precisa de número conectado | Com a sessão conectada: `POST /api/messages/piloto/{jid}/interactive` e `/list` (com e sem `legacyText:true`) para um celular de teste (Android e iOS); anotar o que aparece. O fluxo já está planejado com texto numerado como padrão. |
| Ollama **em container** (`--profile ollama`) | Disco do host com ~5 GB livres; a imagem arm64 tem ~2,8 GB comprimida. Só `docker compose config` foi validado. | Num host Linux/servidor: `COMPOSE_PROFILES=ollama`, `OLLAMA_BASE_URL=http://ollama:11434`, `docker compose up -d`, `docker compose exec ollama ollama pull llama3.2:3b`, `./infra/scripts/check-ollama.sh http://localhost:11435`. |
| Stack em Linux | Só testada no macOS (Docker Desktop) | `./infra/scripts/verify-phase0.sh` no servidor. Em Linux, `host.docker.internal` depende do `extra_hosts: host-gateway` (já configurado). |

## Riscos e observações
- **Disco do host**: está em 98–100% de uso (~2 GB livres depois do build). O build do WA-AKG deixou ~2 GB de cache de build, que não consegui remover seletivamente (o filtro `id=` do `docker builder prune` não funcionou nesta versão do buildx). Não apaguei cache de outros projetos. Para liberar espaço: `docker builder prune` (limpa o cache de build de **todos** os projetos).
- **Contorno de SSRF só para dev** (rede 198.18/15 + CA local). Não usar em produção. No piloto, o bot precisa de URL pública HTTPS e de proteção na borda (firewall/allowlist do IP do WA-AKG), além do HMAC.
- **Webhook sem retry** (confirmado): até a fila da Fase 3 existir, mensagem que chegar com o bot fora do ar é perdida. A Fase 3 deve conferir `GET /api/webhooks/{session}/{id}/logs` para reconciliar.
- Chave privada de dev do bot com `chmod 644`, para o usuário `node` do container ler via bind mount. Só dev; o arquivo está fora do git.
- A senha do Swagger do WA-AKG vem de uma variável `NEXT_PUBLIC_*` (`NEXT_PUBLIC_SWAGGER_PASSWORD`), prefixo que o Next.js pode expor ao frontend `[verificar]`. Ela é aleatória e a porta só escuta em `127.0.0.1`, mas **não expor a porta 3000 publicamente**.
- `node:26-alpine` (base do Dockerfile do WA-AKG) e TS fixado em 6.0: revisar quando o typescript-eslint suportar TS 7.
- Ban/ToS do WhatsApp (G1) continua **alto**: usar só número dedicado.

## Estado deixado
- Stack parada com `docker compose stop` (volumes preservados: sessão `piloto`, webhook e API key coerentes com `infra/.env`). Para retomar: `cd infra && docker compose up -d && ./scripts/verify-phase0.sh` (no macOS, rodar antes `OLLAMA_HOST=0.0.0.0:11434 ollama serve`).
- `infra/.env`, `infra/certs/*` e `vendor/wa-akg` existem localmente e estão fora do git.
