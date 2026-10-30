# @mvp/llm

Camada de linguagem com LLM local (Ollama) atrás de `LlmClient`.

- `OllamaClient`: `/api/chat` com `format` = JSON Schema, temperatura 0, timeout. Erros tipados (`LlmError`: timeout, unavailable, bad_status, empty, invalid_output).
- `generateStructured`: valida a saída com Zod; 1 nova tentativa se inválida.
- `interpretReply(texto, etapa, deps)`: comando → filtro de injeção → parser → LLM. O que o LLM devolve é **revalidado** (número precisa ter base no texto, data válida, opção da lista) e abaixo da confiança mínima vira repergunta. Nunca lança; o estado só avança em `kind: 'answer'`.
- `looksLikeInjection`: filtro barato que roda antes dos parsers e do LLM.
- Prompts: `loadPrompt('../prompts', 'extraction', 2)`.

Configuração (`loadLlmConfig`): `OLLAMA_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_DISABLE_THINKING`.

## Bateria de modelos

```
pnpm --filter @mvp/llm eval -- --models qwen2.5:3b,llama3.2:3b --prompt 2 --out logs/eval.json
```
~70 frases (dinheiro, data, opção, sim/não, duração, nome, intenções, injeção) enviadas direto ao modelo, sem parsers. Mede acerto, JSON válido na 1ª tentativa, injeção (modelo puro e pipeline) e latência p50/p95. Resultado e escolha do modelo: `docs/fases/fase-4.md`.
