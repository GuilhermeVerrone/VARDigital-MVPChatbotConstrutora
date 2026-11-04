STATUS: PASS (testes do pacote `simulation`); `pnpm check` na raiz não fica verde por motivos que já existiam (abaixo)

# Fase 10 — Motor v2: três formas de pagamento (puro)

**Resumo:** `packages/simulation` ganhou `simulatePayment()` para os 3 modos, o plano da entrada com solver, a estimativa do banco sobre o saldo e o seed `ILUSTRATIVO` das condições dos 3 empreendimentos Elevare. Os schemas `SalesCondition` e `PaymentInput` já vinham da PR #1. Pacote `simulation`: **161 testes** passando (104 anteriores + 57 novos).

## O que foi feito

- [`down-payment-plan.ts`](../../packages/simulation/src/down-payment-plan.ts): `buildDownPaymentPlan` (ato mínimo = maior entre fração e piso; mensais com teto de parcelas e piso de valor; reforços opcionais; chaves; juros pela Price; projeção de correção informativa) e `buildUpfrontPlan` (modo 2). Tudo em centavos inteiros.
- **Solver:** para a mensal caber na renda e na parcela desejada, usa só os reforços necessários (se o lead aceita) e depois calcula o ato necessário. A desejada tem três desfechos: dentro, um pouco acima (folga da condição) e inalcançável (menor mensal possível).
- [`payment.ts`](../../packages/simulation/src/payment.ts): `simulatePayment` com parecer, motivos, sugestões e alertas em códigos (como o `simulate`), vigência da condição e modo não oferecido como erros tipados.
- **Estimativa do banco:** reaproveita `simulate()` com o preço da unidade e a entrada inteira já paga. Fica `null` se a condição desliga, se falta o perfil ou os parâmetros; parâmetros fora da vigência geram alerta em vez de erro.
- [`illustrative-sales-conditions.json`](../../packages/simulation/seed/illustrative-sales-conditions.json): Lumen Urban, Parc Verde e Altomare, todas `ILUSTRATIVO`, com números diferentes entre si.
- **Fecha o 06-check §3.4:** a folga da parcela desejada é `installments.desiredInstallmentToleranceRatio` da condição (no `simulate` do financiamento já era `desiredInstallmentToleranceRatio` dos parâmetros).

## Testes

- Casos de referência calculados à mão: 3 modos × viável / com ajustes / inviável; com e sem reforços; juros 0 e > 0; entrega em 0, 1 e 2 meses e distante (teto de parcelas); vigência; condição ou entrada inválida.
- Propriedade (2000 cenários com semente fixa, mais 500 do seed): soma do plano = entrada em centavos exatos, mensais = principal + juros, nada negativo, prazos e piso respeitados, falta = ato − dinheiro.

## Decisões

1. **Ato = maior entre o mínimo e o dinheiro do lead** (regra do discovery §2). Por isso o passo "subir o ato até o dinheiro" do solver já está no ponto de partida; o que sobra é calcular o ato necessário.
2. **Reforços só entram quando precisam.** Com a mensal já cabendo, o lead que aceita reforços não recebe nenhum; o aceite é permissão, não obrigação.
3. **Juros só nas mensais**, pela Price sobre o principal restante; ato, reforços e chaves são nominais. A correção (INCC etc.) é apenas projeção e não muda o plano.
4. **Estimativa do banco na data da simulação** (idade e vigência), não na data das chaves. Está sinalizado no código; vale rever se o financeiro pedir.

## Pendente / conhecido

- `pnpm lint` na raiz falha com 569 erros, todos em `.claude/skills/impeccable/scripts/*.js` (arquivos minificados do commit `489d499`), nenhum em código do projeto. O eslint do pacote `simulation` passa limpo. Falta excluir `.claude/` do `eslint.config.mjs`.
- `pnpm test` na raiz falhou neste ambiente (Windows) com "No test files found" e `TypeError: code.charCodeAt is not a function` do vitest, antes de qualquer teste meu; não investiguei a causa. Só o pacote `simulation` foi executado, isoladamente (`vitest run` dentro de `packages/simulation`). Os demais pacotes não foram tocados.
- Os números do seed são inventados (D9) até o financeiro validar.
