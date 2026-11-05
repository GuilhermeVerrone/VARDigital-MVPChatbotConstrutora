STATUS: PARCIAL. Código, testes (bot 129, llm 31), compose e medição de memória feitos e passando. **A bateria de acerto na Anthropic não foi rodada** (sem chave no ambiente), então o critério "≥ resultado da Fase 4" continua aberto.

# Fase 11b — LLM na Anthropic e stack enxuta para VPS barata

**Resumo:** o LLM do bot passa a ser a API da Anthropic (Haiku 5.5 por padrão), com o Ollama como perfil opcional do compose. A stack padrão sobe sem Ollama e fechou em **726 MiB de pico** sob carga simulada (teto: 2,5 GB).

## O que foi feito

- **`AnthropicClient`** ([anthropic.ts](../../packages/llm/src/anthropic.ts)) com o SDK oficial `@anthropic-ai/sdk`, na mesma interface `LlmClient` do `OllamaClient`. Saída restrita a JSON Schema (`output_config.format`) e revalidada com Zod; sem raciocínio e com esforço `low` (extração curta); timeout e 2 novas tentativas (429, 5xx, rede) do SDK; erros viram `LlmError` tipado, sem repetir o conteúdo da requisição. O schema enviado perde as faixas (`minimum`/`maximum`...) que os structured outputs não aceitam; o Zod continua validando depois.
- **Escolha do provedor**: `LLM_PROVIDER=anthropic|ollama` (padrão `anthropic`), `LLM_MODEL` (vazio = padrão do provedor), `ANTHROPIC_API_KEY` só em `infra/.env`.
- **Teto de chamadas por conversa** (`LLM_MAX_CALLS_PER_CONVERSATION`, padrão 30) em [budget.ts](../../packages/llm/src/budget.ts). Estourou, o bot repergunta usando só os parsers.
- **Minimização de dados** ([privacy.ts](../../packages/llm/src/privacy.ts)):
  - campos de nome, telefone e e-mail **nunca** vão ao LLM (só os parsers leem; se falharem, repergunta);
  - o texto enviado é mascarado: e-mail, telefone/CPF/CNPJ (10 a 14 dígitos) e as palavras do nome do lead, que o orquestrador já conhece;
  - valores em reais não são afetados;
  - o conteúdo não vai para os logs.
- **Sem chave ou API fora do ar**: o bot segue só com os parsers. `GET /health/deps` agora devolve `llm` (antes `ollama`): sem chave ou com a última chamada falhando nos últimos 5 min, `status: degraded` com HTTP 200. Banco fora continua 503.
- **Prompt `extraction.v3`** (já com `paymentMode`, `acceptsBalloons` e `cashNow`) e 14 casos novos na bateria (grupo `payment`).
- **Bateria com custo** (`--provider anthropic`): informa acerto, injeção, latência e **custo por 1.000 turnos** (tokens por chamada × preço do modelo).
- **Compose enxuto**: Ollama só no perfil `ollama`; `mem_limit` por container; heap do Node abaixo do limite; MySQL do WA-AKG com buffer de 64 MB e sem `performance_schema`; Postgres do bot com `shared_buffers` de 48 MB; [setup-swap.sh](../../infra/scripts/setup-swap.sh) (2 GB, `swappiness=10`); o `init-env.sh` não liga mais o Ollama no Linux.
- **Consentimento provisório** citando a Anthropic como operadora (`ilustrativo-2`, `RASCUNHO` até a revisão jurídica).

## Medição de memória

Stack padrão (WA-AKG + MySQL, bot + Postgres), `docker stats`, imagens construídas na própria máquina (Docker Desktop, VM de 8 GB).

| Container | `mem_limit` | Ocioso (pico) | Sob carga (pico) |
|---|---|---|---|
| bot | 256 MB | 153 MiB | 193 MiB |
| bot-db (Postgres) | 256 MB | 38 MiB | 56 MiB |
| wa-akg | 640 MB | 226 MiB | 215 MiB |
| wa-akg-db (MySQL) | 384 MB | 262 MiB | 262 MiB |
| **Soma dos picos** | 1,5 GB | **678 MiB** | **726 MiB** |

- Carga: [simulate-load.mjs](../../infra/scripts/simulate-load.mjs), 40 conversas × 25 mensagens (1.000 webhooks assinados, todos 200) em ~40 s. O bot processou ~800 delas em ~1 min, criou 39 leads e fez 587 envios; nenhum container teve OOM ou reinício.
- Imagens: bot 277 MB, WA-AKG 1,9 GB.
- Medição: [measure-memory.sh](../../infra/scripts/measure-memory.sh).

**Decisão sobre juntar os bancos (D5): não juntar.** O Postgres do bot usa ~55 MiB; o MySQL (262 MiB) é do WA-AKG e não se junta ao Postgres. Sobram ~1,8 GB de folga no teto, o que também comporta o site e o painel (Next.js, ~150 a 250 MiB cada, a medir na Fase 16).

### Limites desta medição (não leia como o número final)

1. **Sem sessão de WhatsApp.** O WA-AKG ficou sem número conectado; com uma sessão real do Baileys ele usa mais memória. Para o bot processar, as respostas foram para um servidor falso ([fake-wa-akg.mjs](../../infra/scripts/fake-wa-akg.mjs)); o WA-AKG real continuou no ar, só ocioso.
2. **Sem LLM.** Não havia chave, então a carga não incluiu chamadas à Anthropic. O custo em memória delas é pequeno (cliente HTTP), mas não foi medido.
3. **`TYPING_MAX_MS=0`** na carga. Com os 2 s padrão de "digitando…" o worker (uma mensagem por vez) drena ~0,5 msg/s.
4. **Sem site nem painel** (Fases 13 a 15). A medição final é refeita na Fase 16, como o plano prevê.
5. A VM do Docker Desktop tem 8 GB, não 4. O que vale é o `mem_limit` por container e o uso medido, mas não testei numa máquina de 4 GB de verdade.

## Aceite

| Critério | Situação |
|---|---|
| Bateria com a Anthropic ≥ Fase 4 (LLM ≥ 85%, injeção 100% pelo pipeline) | **Não verificado.** Rodar: `ANTHROPIC_API_KEY=… pnpm --filter @mvp/llm eval -- --provider anthropic --models claude-haiku-5-5 --prompt 3 --runs 2 --out docs/fases/fase-11b-eval.json`. Faz centenas de chamadas pagas (com Haiku 5.5 a US$ 0,10/0,50 por milhão de tokens, centavos de dólar por rodada). O filtro de injeção e a revalidação são os mesmos da Fase 4, e a bateria ganhou 1 caso de injeção novo (`p14`). |
| Teste que captura o corpo da requisição: sem nome, telefone nem e-mail | **Feito** (`packages/llm/test/anthropic.test.ts`, com o corpo capturado pelo `fetch` do SDK). |
| Sem chave ou API fora: bot segue com parsers, repergunta e `/health` acusa | **Feito** (`apps/bot/test/llm-provider.test.ts`, `webhook.test.ts`; confirmado na stack real: `{"status":"degraded", "llm":{"ok":false,"detail":"ANTHROPIC_API_KEY ausente: só parsers"}}`). |
| Stack padrão sobe sem Ollama e ≤ 2,5 GB medidos | **Feito**: 726 MiB (ressalvas acima). |

## Decisões

1. **SDK oficial em vez de `fetch` cru**, por orientação da documentação do SDK para projetos TypeScript. Entra a dependência `@anthropic-ai/sdk` em `@mvp/llm`.
2. **Sem raciocínio e esforço `low`**: extração curta de campo; o raciocínio só somaria latência e custo. Sem `temperature` (o Haiku 5.5 recusa valores diferentes do padrão).
3. **Campos de identificação fora do LLM** em vez de só mascarar: o nome do lead é o próprio valor a extrair, então a única forma de não enviá-lo é não chamar o LLM nesses passos.
4. **LLM degradado não derruba o `/health/deps`** (200, não 503): o bot funciona sem ele, e um 503 faria um orquestrador reiniciar o que está saudável.
5. **O texto livre ainda pode conter um nome que o lead não informou antes** (ex.: um nome de terceiro numa resposta). Só o nome do próprio lead é mascarado. Risco residual, a tratar com o jurídico.

## Pendente

- Rodar a bateria na Anthropic (acima) e registrar acerto, injeção, latência e custo por 1.000 turnos aqui.
- Confirmar com a conta da API os termos de retenção e de treinamento (plano, seção de pendências do usuário).
- Revisão jurídica do texto de consentimento `ilustrativo-2`.
- Refazer a medição na Fase 16, com site, painel, sessão de WhatsApp real e chamadas ao LLM.
- O `prompts/extraction.v3.md` não foi medido contra modelo nenhum; o v2 segue como referência da Fase 4.
