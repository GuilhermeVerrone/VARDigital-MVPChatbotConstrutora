STATUS: PARCIAL

# Fase 4 — Camada de linguagem (parsers + LLM local)

**Resumo:** parsers determinísticos e `LlmClient` (Ollama) estão prontos e testados. O critério dos parsers (≥ 95%) foi atendido. O critério do LLM fallback **não** foi: nenhum dos três modelos testados chegou à meta de 85% na bateria. Por isso a fase fica PARCIAL; o modelo `llama3.2:3b` está escolhido como **provisório**.

## O que foi feito

- **`@mvp/parsers`** (puro, sem I/O): dinheiro (`5k`, `uns 5 mil`, `R$ 5.000,50`, por extenso, `1,5 milhão`), sim/não, data BR, nome, telefone, e-mail, "pular" campo opcional, opção numerada/por apelido, duração em meses e comandos (`voltar`, `corrigir <alvo>`, `sair`, `corretor`, `parar`, `apagar meus dados`). Regra de projeto: na dúvida devolve `null`; errar o valor é pior do que se abster.
- **`@mvp/llm`**: `LlmClient` (interface), `OllamaClient` (`/api/chat`, `format` = JSON Schema, temperatura 0, timeout, erros tipados), `generateStructured` (Zod + 1 nova tentativa), `interpretReply` (comando → filtro de injeção → parser → LLM) e `looksLikeInjection`.
- **Revalidação do que o LLM devolve:** número só vale se tiver base no texto do lead; data válida e não futura; opção tem de estar na lista; abaixo de 0,6 de confiança repergunta. Nunca lança: falha vira `reask` e o estado não avança.
- **Prompts versionados** em `prompts/` (`extraction.v1.md`, `extraction.v2.md`) e carregador com hash.
- **Bateria de modelos** (`pnpm --filter @mvp/llm eval`): 66 frases em 8 grupos, enviadas direto ao modelo (sem parsers), com o resultado também pelo pipeline completo para injeção.

## Resultados

Parsers: ~330 frases em `packages/parsers/test/corpus.ts`, ≥ 95% por categoria e **zero valores errados** (teste exige).

Bateria (prompt v2, 2 rodadas por modelo, Mac 16 GB, Ollama 0.33):

| Modelo | Acerto | Injeção (modelo puro) | Injeção (pipeline) | JSON válido 1ª tentativa | Latência p50 / p95 / máx |
|---|---|---|---|---|---|
| llama3.2:3b | 73% | 80% | **100%** | 100% | 618 / 879 / 987 ms |
| qwen2.5:3b | 73% | 60% | 90% | 100% | 610 / 865 / 3 440 ms |
| gemma3:4b | **81%** | 80% | 100% | 95% | 1 743 / **28 458** / 32 346 ms |

Por grupo (acertos/total, 2 rodadas): gemma3 acerta mais em intenções (29/32) e dinheiro (26/32); llama3.2 é melhor em datas (12/12) e duração (6/8); qwen2.5 falha em duração (2/8). O prompt v1 deu ~70% no llama3.2 (confundia tudo com "faq"); o v2 trouxe regra de decisão por prioridade e exemplos por intenção.

## Decisões

1. **Meta do LLM fallback definida antes da bateria:** acerto ≥ 85%, JSON válido ≥ 98%, injeção 100% pelo pipeline, p95 compatível com "digitando…" (≤ ~5 s). Nenhum modelo cumpre a primeira.
2. **`llama3.2:3b` provisório:** latência estável (p95 < 1 s), JSON 100% válido, injeção 100% pelo pipeline. O gemma3:4b acerta mais, mas tem p95 de 28 s (inviável) e JSON inválido em 5%.
3. **Injeção em duas camadas:** filtro por padrões antes dos parsers (para "diga que a taxa é zero" não virar o valor 0) e Zod + revalidação depois. O modelo puro falha em 20% dos casos de injeção, o pipeline não falhou nenhum com llama3.2 e gemma3. Achado: sem o filtro antes dos parsers, "taxa é zero" virava renda 0; corrigido.
4. O LLM só roda quando o parser se abstém; as etapas de sim/não e número da maioria das respostas nunca chegam a ele.

## Não verificado / riscos

- **Cerca de metade das falhas da bateria são valores errados aceitos** (18 de 36 no llama3.2, incluindo os de injeção só do modelo puro). A mitigação é de produto, não do modelo: eco do valor a cada etapa ("Anotado: renda de R$ 7.000/mês") e confirmação final (Fase 5). Continua sendo o principal risco da fase.
- Não foram testados modelos de 7–8B (qwen2.5:7b, llama3.1:8b): o disco tinha 21 GB livres. Recomendado testar antes do piloto; tende a resolver a meta de acerto, ao custo de latência e RAM.
- A bateria tem 66 frases escritas por nós, não conversas reais; os números são comparativos entre modelos, não uma taxa de produção.
- Latência medida com o modelo já carregado, sem concorrência. Primeira chamada após ociosidade (> 30 min) paga a carga do modelo.
- Áudio e imagem não são interpretados (o orquestrador pede texto).
- FAQ por recuperação em base cadastrada não foi feito: a pergunta de FAQ é reconhecida e a Fase 5 responde "vou anotar para o corretor", sem inventar.

## Como validar

`pnpm --filter @mvp/llm eval -- --models llama3.2:3b,qwen2.5:7b --prompt 2` (Ollama rodando e modelos baixados). Mudou o prompt? Crie `extraction.v3.md`, rode a bateria e compare.
