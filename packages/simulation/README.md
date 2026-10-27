# @mvp/simulation — motor de simulação (puro)

Cálculo determinístico da pré-simulação de financiamento (spec §4, RF-15 a RF-24). Sem I/O, sem relógio, sem banco: `simulate(entrada, parametros)` → resultado. O LLM nunca calcula; todo número mostrado ao lead sai daqui.

> **Parâmetros ILUSTRATIVOS.** `seed/illustrative-parameters.json` tem taxas, faixas, cotas e subsídios **inventados**. Toda simulação com eles traz o alerta `ILLUSTRATIVE_PARAMETERS`. Não usar com lead real antes da validação do financeiro.

## O que calcula

| Regra | Onde | Observação |
|---|---|---|
| Enquadramento por linha (renda, teto do imóvel, 1º financiamento, imóvel próprio) | `simulate.ts` → `checkEligibility` | Avalia todas as linhas; escolhe a de melhor parecer, com empate decidido pela `priority` |
| Comprometimento: `parcela_max = renda × % − dívidas` | `evaluateLine` | Renda e dívidas do co-proponente somam |
| Valor financiável = MIN(cota, o que cabe na parcela) | `maxPrincipalForInstallment` | Usa a **1ª parcela com seguros e taxas** (é a maior em SAC e Price) |
| SAC e Price, 1ª/última parcela, totais | `amortization.ts` | Cronograma completo disponível em `buildSchedule` |
| Seguros MIP (por faixa de idade, sobre o saldo) e DFI (sobre o valor do imóvel), taxa adm. e tarifas | `amortization.ts`, `mipRateFor` | Faixa de MIP pela idade na assinatura (regra `ageRule`) |
| Juros nominal × efetivo | `rates.ts` | `rateConvention` por linha |
| Limite por idade: `idade + prazo ≤ idade máx.` | `termFor` | `OLDEST`/`YOUNGEST` com co-proponente |
| FGTS na entrada | `fgtsFor` | Tempo mínimo por proponente, imóvel próprio, teto do imóvel |
| Subsídio por faixa de renda | `subsidyFor` | Tabela por linha |
| Entrada necessária = imóvel − financiável − subsídio − FGTS | `evaluateLine` | Ordem de uso: subsídio → FGTS → dinheiro |
| Parecer VIAVEL / VIAVEL_COM_AJUSTES / INVIAVEL | `evaluateLine` | Tolerância = `adjustmentToleranceRatio` × entrada necessária |
| Fluxo de obra simples (sinal, mensais, reforços, chaves) | `construction-flow.ts` | Em centavos inteiros; soma exata |

Saídas textuais (mensagens ao lead) **não** estão aqui: o motor devolve códigos (`reasons`, `suggestions`, `alerts`) que o orquestrador transforma em templates (Fases 5–6).

## Uso

```ts
import { illustrativeParameters, simulate } from '@mvp/simulation';
const result = simulate(input, illustrativeParameters); // valida entrada e parâmetros com Zod
```

Erros tipados: `InvalidSimulationInputError`, `InvalidParametersError`, `ParametersNotInForceError` (data fora da vigência da tabela).

## Para o financeiro validar (sem banco, sem WhatsApp)

1. **Rodar um caso:** edite `examples/lead-exemplo.json` e rode, na raiz do repositório:
   ```bash
   pnpm --filter @mvp/simulation simulate packages/simulation/examples/lead-exemplo.json [parametros.json]
   ```
2. **Conferir SAC/Price:** `reference/reference-cases.csv` (abre no Excel/LibreOffice, separador `;`) tem 16 casos calculados **à parte** por `reference/generate_reference.py`, com aritmética decimal em Python. A suíte de testes exige que o motor bata **centavo a centavo** com eles.
3. **Adicionar os casos da planilha oficial:** crie `test/fixtures/<nome>.json` no mesmo formato de `test/fixtures/reference-cases.json`. Todo `.json` dessa pasta entra automaticamente em `pnpm test`.

## Convenções de arredondamento

- Cálculo interno sem arredondar; cada valor de saída arredondado a centavos, com meio centavo para cima (como `ARRED`).
- Tetos (financiável) truncados a centavos: a parcela nunca passa do limite.
- A última parcela quita o saldo exato.
- Ruído de ponto flutuante abaixo de 15 dígitos significativos é descartado antes de arredondar. Por isso 2,625 vira 2,63, e não 2,62.
