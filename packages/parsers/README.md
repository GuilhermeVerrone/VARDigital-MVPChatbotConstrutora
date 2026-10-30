# @mvp/parsers

Parsers determinísticos de respostas de lead em PT-BR (spec §9.2: parser primeiro, LLM só como fallback). Todos puros, sem I/O. Devolvem `null` quando não têm certeza: quem chama repergunta ou aciona o LLM. Errar o valor é pior do que se abster.

| Função | Entende |
|---|---|
| `parseMoney` | `5k`, `uns 5 mil`, `R$ 5.000,50`, `cinco mil e duzentos`, `1,5 milhão`, `nada`. Vários valores ou negação → `null` |
| `parseYesNo` | sim/não, `tenho sim`, `não possuo`, 👍. `talvez`/`não sei`/misto → `null` |
| `parseDate` | `05/03/1990`, `5 de março de 90`, `05031990` → `AAAA-MM-DD` (dia primeiro; futuro → `null`) |
| `parseName` | mínimo 2 palavras; remove "meu nome é…"; rejeita saudações e dígitos |
| `parsePhone` | BR com/sem +55, máscara; acrescenta o 9 em celular antigo |
| `parseEmail`, `isSkip` | e-mail único; "pular" campo opcional |
| `parseOption` | `2`, `opção 2`, `a segunda`, `letra b`, ou o texto/apelido da opção |
| `parseDurationMonths` | `2 anos e meio` → 30 |
| `parseCommand` | voltar, corrigir (+alvo), sair, falar com corretor, parar de receber, apagar meus dados |

O conjunto de teste está em `test/corpus.ts` (frases + resultado esperado); `pnpm test` exige ≥ 95% por categoria e **zero valores errados**.
