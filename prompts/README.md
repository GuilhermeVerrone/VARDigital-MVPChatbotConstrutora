# prompts

Prompts versionados do LLM do bot (regras em docs/01-prompt-guide.md, Parte B).

- `extraction.v<N>.md`: leitura de resposta do lead (intenção + campos + confiança). Nunca edite uma versão em uso: crie `v<N+1>`.
- Mudou o prompt? Rode a bateria (`pnpm --filter @mvp/llm eval -- --models <modelo> --prompt <N>`) e registre o resultado em `docs/fases/fase-4.md`.
- `v1`: primeira versão (bateria: ~70% com llama3.2:3b, confundia tudo com "faq"). `v2`: regra de decisão por ordem de prioridade e exemplos por intenção.
