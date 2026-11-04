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

## Formas de pagamento (V2)

`simulatePayment(input, condition, bankParams?)` cobre os 3 modos, todos governados por uma `SalesCondition` (nenhum número de negócio no código; seed `ILUSTRATIVO` dos 3 empreendimentos em `illustrativeSalesConditions`):

| Modo | O que calcula |
|---|---|
| `A_VISTA` | Preço com o desconto da condição. |
| `ENTRADA_A_VISTA` | Entrada (maior entre mínima e desejada, limitada à máxima) contra o dinheiro disponível; saldo para o financiamento nas chaves. |
| `ENTRADA_PARCELADA` | `buildDownPaymentPlan`: ato, mensais (teto de parcelas, piso do valor, juros pela Price), reforços, parcela de chaves e projeção informativa de correção. |

Solver do modo 3, para a mensal caber na renda (e na parcela desejada, com folga da condição): usa reforços (se o lead aceita), depois calcula o **ato necessário**. A falta de dinheiro dentro de `adjustmentToleranceRatio` da entrada dá "viável com ajustes".

A estimativa do banco sobre o saldo reaproveita `simulate()` (precisa do perfil `financing` e dos parâmetros bancários). Erros tipados: `SalesConditionNotInForceError`, `PaymentModeNotOfferedError`, `InvalidPaymentInputError`, `InvalidSalesConditionError`. Em centavos, ato + principal das mensais + reforços + chaves = entrada, sempre.

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
