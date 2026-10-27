STATUS: PASS

# Fase 1 — Motor de simulação (puro)

Data: 2026-10-26. Executada em modo autônomo. Pré-requisito conferido: a Fase 0 terminou com `STATUS: PARCIAL`, não `FALHA`, e os itens pendentes dela (QR code, Ollama em container, formato real do LID) não afetam esta fase. Por isso não havia o que corrigir antes.

**Resumo:** `packages/simulation` implementa o motor completo como função pura, `simulate(entrada, parametros)`, sem I/O e sem relógio. Os três critérios de aceite da Fase 1 em `docs/04-plano.md` passaram:

1. **SAC e Price batem centavo a centavo** com 16 casos de referência calculados **à parte**, por uma implementação independente em Python com aritmética decimal de 50 dígitos. Também batem com casos de livro-texto conferíveis à mão.
2. **Casos de borda** testados: parcela_max ≤ 0, idade (limita o prazo e bloqueia) e cota.
3. **Cálculo < 1 s:** uma simulação completa leva **2,67 ms**.

Esta fase não depende de Docker, Ollama nem WhatsApp, então tudo foi verificado de verdade. A validação **pelo financeiro**, com a planilha oficial e as taxas reais, continua sendo pendência externa. O plano diz explicitamente que ela "não bloqueia a Fase 0–1". O motor já está preparado para recebê-la (ver "Como o financeiro valida").

## O que foi feito

`packages/simulation` (`@mvp/simulation`), com tudo o que a Fase 1 pede:

| Entrega do plano | Implementação |
|---|---|
| Price e SAC | `amortization.ts`: cronograma completo, 1ª e última parcela, totais (pago, juros, seguros, taxas). Taxa zero tratada. |
| Comprometimento de renda | `parcela_max = renda_familiar × %linha − dívidas` (spec §4.1). Renda e dívidas do co-proponente somam. |
| Valor financiável | `MIN(valor × cota, o que cabe na parcela)` (spec §4.2). O "que cabe" é calculado em forma fechada sobre a **1ª parcela com seguros e taxas** e truncado em centavos. |
| Entrada necessária | `imóvel − financiável − subsídio − FGTS` (spec §4.3). |
| Seguros e taxa adm. | MIP por faixa de idade sobre o saldo devedor; DFI sobre o valor do imóvel; taxa de administração + tarifas extras parametrizadas. Juros nominal ou efetivo por linha, e a saída traz as duas taxas anuais. |
| Limite por idade | `idade + prazo ≤ idade máx. ao fim` (em meses). Regra `OLDEST`/`YOUNGEST` com co-proponente. Prazo desejado ajustado aos limites, com alerta. |
| Enquadramento por linha | Renda máxima, teto do imóvel, 1º financiamento e "não possui imóvel". Todas as linhas são avaliadas; as inelegíveis vêm com o motivo. |
| FGTS na entrada | Tempo mínimo de contribuição por proponente, bloqueio por imóvel próprio e teto do imóvel. Os saldos dos proponentes aptos somam. |
| Subsídio | Tabela por faixa de renda, com teto do imóvel (RF-22 simplificado). |
| Parecer | `VIAVEL` / `VIAVEL_COM_AJUSTES` / `INVIAVEL`, com `reasons`, `suggestions` (aumentar entrada, co-proponente, prazo maior, unidade menor, quitar dívidas, planejar entrada, voltar depois) e `alerts` (RF-34: idade limita o prazo, renda informal, comprometimento alto, entrada insuficiente, FGTS sem tempo mínimo etc.). |
| Fluxo de obra simples | `construction-flow.ts`: sinal + mensais + reforços até a entrega, tudo em centavos inteiros (a soma é exatamente a entrada), e chaves = financiamento + FGTS + subsídio. Há alerta se a mensal da obra passar da capacidade. |
| Parâmetros injetados | `params.ts`: schema Zod de todas as regras (linhas, cotas, taxas, seguros, idade, prazos, FGTS, subsídio, tolerância, vigência). **Nenhum valor de negócio no código.** |
| Seed `ILUSTRATIVO` | `seed/illustrative-parameters.json`: faixa A, faixa B e SBPE, com valores inventados e marcados. Toda simulação com ele traz o alerta `ILLUSTRATIVE_PARAMETERS`. |

Extras para validação isolada pelo financeiro (o plano diz que a fase "pode ser validada pelo financeiro isoladamente"):

- `reference/generate_reference.py` → `test/fixtures/reference-cases.json` + `reference/reference-cases.csv` (planilha de referência em CSV `;`).
- `scripts/simulate.ts`: CLI que roda uma simulação a partir de JSON. Exemplo em `examples/lead-exemplo.json`.
- Todo `.json` em `test/fixtures/` entra automaticamente na suíte. A planilha do financeiro vira teste só de colocar o arquivo lá.
- `packages/simulation/README.md` com regras, convenções de arredondamento e o passo a passo do financeiro. `README.md` da raiz atualizado.

### Commits (sem push, sem co-autoria)
```
3aac54f tighten age boundary test
7fa3366 add simulation engine with illustrative seed
20a50cb add sac/price amortization with reference cases
```
(+ o commit deste relatório)

## Arquivos principais
- `packages/simulation/src/amortization.ts`: SAC/Price, cronograma, teto pelo valor da parcela
- `packages/simulation/src/simulate.ts`: enquadramento, capacidade, idade, FGTS, subsídio, parecer, seleção de linha
- `packages/simulation/src/params.ts` e `src/input.ts`: schemas Zod de parâmetros e entrada, com erros tipados
- `packages/simulation/src/construction-flow.ts`, `src/rates.ts`, `src/money.ts`, `src/dates.ts`, `src/seed.ts`, `src/index.ts`
- `packages/simulation/seed/illustrative-parameters.json`
- `packages/simulation/reference/generate_reference.py`, `reference/reference-cases.csv`, `test/fixtures/reference-cases.json`
- `packages/simulation/test/{amortization,simulate,helpers-units,performance}.test.ts`, `test/helpers.ts`
- `packages/simulation/scripts/simulate.ts`, `examples/lead-exemplo.json`, `README.md`
- Raiz: `tsconfig.json` (inclui `packages/*/scripts`), `README.md`, `pnpm-lock.yaml`

## Decisões (pelas recomendações dos docs ou por necessidade técnica)

| # | Decisão | Motivo |
|---|---|---|
| F1-1 | A "planilha calculada à parte" é uma **implementação independente em Python** (`decimal`, 50 dígitos), com saída em JSON (testes) e CSV (humanos). Tem autoverificação com valores de livro-texto (Price 100.000 a 1% em 12 meses = 8.884,88; SAC 120.000 = 11.200 … 10.100). | A planilha do financeiro ainda não existe (pendência externa). Outra linguagem com aritmética exata pega erros de fórmula que um teste escrito sobre o próprio código TS não pegaria. |
| F1-2 | Cálculo em `number` (double), sem arredondar no meio. Saída arredondada a centavos, com meio centavo para cima. Tetos truncados. Ruído abaixo de 15 dígitos significativos é descartado antes de arredondar (`toPrecision(15)`). | É a mesma precisão de Excel/LibreOffice. Bateu com o decimal de 50 dígitos nos 16 casos. Dois meio-centavos exatos (teto 60.000,00 com taxa zero; MIP 2,625) mostraram que o próprio gerador precisava da mesma limpeza de ruído. O ajuste foi feito no gerador, não no motor. |
| F1-3 | O comprometimento usa a **1ª parcela com MIP, DFI e taxas**, e `(1ª parcela + dívidas) / renda` é o percentual informado. | É conservador: a 1ª parcela é a maior nos dois sistemas. **[validar com financeiro]**: alguns bancos não incluem os seguros no limite. |
| F1-4 | A taxa de MIP é fixada pela faixa de idade **na assinatura** e não muda durante o contrato. | Simplificação do MVP. Bancos reajustam o MIP por faixa etária ao longo do contrato. |
| F1-5 | Seleção da linha: avalia todas as elegíveis e escolhe a de **melhor parecer**; no empate, a de menor `priority`. | O spec (RF-15) pede "a linha elegível" sem critério de desempate. Assim o lead não recebe "inviável" numa linha quando outra o atende. |
| F1-6 | Ordem das fontes não financiadas: subsídio → FGTS → dinheiro. Por padrão o motor financia o máximo e mostra a **entrada mínima** (campos do dossiê, spec §6). `useFullDownPayment: true` usa toda a entrada e financia menos. | Prepara o "ajuste de entrada com recálculo" da Fase 6 (RF-27). |
| F1-7 | Tolerância do parecer "com ajustes" = `adjustmentToleranceRatio` × **entrada necessária**. No seed, 10%. | É a leitura de "ex.: 10% da entrada" do spec §4.3. É parâmetro, e há teste mostrando que mudá-lo muda o parecer. |
| F1-8 | FGTS só **na entrada**. O uso na amortização (parte do RF-21) ficou fora. | O plano da Fase 1 lista "FGTS na entrada". |
| F1-9 | No fluxo de obra, a entrada é dividida em sinal / reforços / mensais, e as chaves = financiamento + FGTS + subsídio. As parcelas de evolução de obra (juros ao banco durante a obra) **não** são modeladas e vêm marcadas `constructionInterestModeled: false`. | O plano pede um "fluxo de obra simples". O spec §16.8 (tabela de fluxo por empreendimento) está em aberto. |
| F1-10 | O motor devolve **códigos** (`reasons`, `suggestions`, `alerts`), nunca texto. | O texto ao lead é template do orquestrador (Fases 5–6). Isso garante que nenhum número venha do LLM (spec §9.2). |
| F1-11 | A data de referência é **injetada**, e o motor recusa parâmetros fora da vigência (`ParametersNotInForceError`). | Função pura e testável. Antecipa a regra da Fase 2 de "usar a versão vigente e registrar a versão": o resultado traz `parametersVersion`. |
| F1-12 | O valor do imóvel e o plano de obra (data de entrega, % de sinal e reforços) entram na **entrada** da simulação, não nos parâmetros financeiros. | São dados do empreendimento/unidade (Fase 2), não regras de crédito. |
| F1-13 | Idade em **meses completos**, com idade máxima em meses (`maxAgeAtEndMonths`, ex.: 80a6m = 966). Menor de 18 é **entrada inválida**, não parecer. | O limite de idade bancário é em anos e meses. O spec §3.2 exige "idade entre 18 e limite do produto". |
| F1-14 | Quando a idade bloqueia o prazo, o motor sugere co-proponente mesmo com a regra `OLDEST`. | Segue o spec §12 ("sugerir co-proponente"). O corretor avalia. |
| F1-15 | Commits direto em `main`. | Mesma razão da F0-7: o runner executa as fases em sequência na mesma árvore. |

## Resultados dos testes (saída real)

### `pnpm check` (lint + typecheck + testes de todo o monorepo)
```
> mvp-chatbot-construtora@ check /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
> pnpm lint && pnpm typecheck && pnpm test
> mvp-chatbot-construtora@ lint /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
> eslint .
> mvp-chatbot-construtora@ typecheck /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
> tsc -p tsconfig.json
> mvp-chatbot-construtora@ test /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
> vitest run
 RUN  v5.0.5 /Users/guilhermeverr1/Projetos/2 - VarDigital/mvp-chatbot-construtora
 Test Files  7 passed (7)
      Tests  130 passed (130)
   Start at  23:57:05
   Duration  236ms (import 52%, tests 31%, transform 14%, worker 3%)
```
Exit 0. Lint e typecheck sem mensagens. São 130 testes: 100 do motor e os 30 das fases anteriores, que continuam verdes.

### `vitest run --project simulation --reporter=verbose`
```
✓ |simulation| test/helpers-units.test.ts > arredondamento > meio centavo arredonda para cima, inclusive com ruído binário 1ms
✓ |simulation| test/helpers-units.test.ts > arredondamento > teto trunca, mas não por ruído binário 0ms
✓ |simulation| test/helpers-units.test.ts > taxas > nominal: mensal = anual / 12 0ms
✓ |simulation| test/helpers-units.test.ts > taxas > efetiva: (1 + a)^(1/12) − 1 e volta para a mesma anual 0ms
✓ |simulation| test/helpers-units.test.ts > datas > idade em meses completos 0ms
✓ |simulation| test/helpers-units.test.ts > datas > meses entre datas (negativo para trás) 0ms
✓ |simulation| test/helpers-units.test.ts > datas > rejeita datas inexistentes ou mal formatadas 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 0 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 0.01 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 0.07 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 1234.56 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 33333.33 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 98765.43 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > entrada 150000 0ms
✓ |simulation| test/helpers-units.test.ts > fluxo de obra: soma exata em centavos > sem reforços (ratio 0) tudo vira sinal + mensais 0ms
[desempenho] simulação única (fria): 2.67 ms
✓ |simulation| test/amortization.test.ts > casos de livro-texto (conferíveis à mão) > Price: 100.000 a 1% a.m. em 12 meses → parcela 8.884,88 1ms
✓ |simulation| test/amortization.test.ts > casos de livro-texto (conferíveis à mão) > SAC: 120.000 a 1% a.m. em 12 meses → 11.200 … 10.100, juros 7.800 0ms
✓ |simulation| test/amortization.test.ts > casos de livro-texto (conferíveis à mão) > seguros e taxa: MIP sobre o saldo, DFI e taxa fixos 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-livro-100k-1pct-12 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-livro-120k-1pct-12 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-taxa-zero 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-taxa-zero 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-sbpe-300k-360 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-sbpe-300k-360 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-sbpe-250k-420 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-sbpe-250k-420 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-habitacional-180k-360 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-habitacional-180k-360 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-alto-1m-240 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-alto-1m-240 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-curto-50k-60 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-curto-50k-60 0ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > sac-fracao-centavos 1ms
✓ |simulation| test/amortization.test.ts > casos de referência calculados à parte (16 casos, Python decimal) > price-fracao-centavos 1ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > SAC quita o saldo e amortiza exatamente o principal 1ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > PRICE quita o saldo e amortiza exatamente o principal 1ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > SAC: amortização constante e parcelas decrescentes 2ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > Price: parcela-base (amortização + juros) constante 0ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > SAC: teto de financiamento é o maior valor cuja 1ª parcela cabe 4ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > PRICE: teto de financiamento é o maior valor cuja 1ª parcela cabe 4ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > teto é zero se a parcela não cobre nem seguros/taxas 0ms
✓ |simulation| test/amortization.test.ts > propriedades do cronograma > rejeita prazo e valor inválidos 0ms
✓ |simulation| test/simulate.test.ts > parecer (spec §4.3, RF-24) > VIAVEL: entrada disponível cobre a necessária; cota limita (casos à mão) 3ms
✓ |simulation| test/simulate.test.ts > parecer (spec §4.3, RF-24) > VIAVEL_COM_AJUSTES: falta de entrada dentro da tolerância (10% da entrada) 1ms
✓ |simulation| test/simulate.test.ts > parecer (spec §4.3, RF-24) > limite exato da tolerância é ajuste; um centavo acima é inviável 1ms
✓ |simulation| test/simulate.test.ts > parecer (spec §4.3, RF-24) > INVIAVEL: falta de entrada acima da tolerância 0ms
✓ |simulation| test/simulate.test.ts > parecer (spec §4.3, RF-24) > a tolerância vem do parâmetro, não do código 1ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > parcela limita o financiamento: sugere co-proponente e prazo maior 1ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > dívidas reduzem a parcela máxima 0ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > INVIAVEL quando dívidas = 30% da renda (parcela_max = 0) 0ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > INVIAVEL quando dívidas acima de 30% (parcela_max < 0) 0ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > INVIAVEL quando a parcela_max não cobre nem seguros e taxas 0ms
✓ |simulation| test/simulate.test.ts > capacidade de pagamento (spec §4.1, RF-16) > co-proponente soma renda e dívidas 0ms
✓ |simulation| test/simulate.test.ts > cota de financiamento (spec §4.2) > cota diferente muda o financiável (parâmetro injetado) 0ms
✓ |simulation| test/simulate.test.ts > cota de financiamento (spec §4.2) > cota 100% com renda alta: entrada zero 0ms
✓ |simulation| test/simulate.test.ts > cota de financiamento (spec §4.2) > valor financiável é o MENOR entre cota e parcela 2ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > idade limita o prazo: 60 anos com idade máx. 80 → 240 meses 0ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > idade no limite exato do prazo mínimo ainda é simulável 0ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > INVIAVEL quando a idade não permite nem o prazo mínimo (fronteira de um dia) 0ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > co-proponente: regra OLDEST usa o mais velho; YOUNGEST o mais novo 0ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > prazo desejado fora dos limites é ajustado e sinalizado 0ms
✓ |simulation| test/simulate.test.ts > idade e prazo (spec §4.5) > menor de 18 anos é entrada inválida 1ms
✓ |simulation| test/simulate.test.ts > FGTS na entrada (spec §4.6, RF-21) > FGTS reduz a entrada em dinheiro 0ms
✓ |simulation| test/simulate.test.ts > FGTS na entrada (spec §4.6, RF-21) > sem o tempo mínimo de contribuição, FGTS não entra 0ms
✓ |simulation| test/simulate.test.ts > FGTS na entrada (spec §4.6, RF-21) > quem já possui imóvel não usa FGTS (regra da linha) 0ms
✓ |simulation| test/simulate.test.ts > FGTS na entrada (spec §4.6, RF-21) > FGTS maior que o necessário reduz o financiamento, nunca passa do valor do imóvel 0ms
✓ |simulation| test/simulate.test.ts > FGTS na entrada (spec §4.6, RF-21) > soma FGTS dos dois proponentes que cumprem o tempo mínimo 0ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > renda baixa + imóvel no teto → faixa A, com subsídio da tabela 2ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > renda acima da faixa A → faixa B; a faixa A aparece como inelegível por renda 2ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > renda alta → só SBPE (taxa efetiva) 0ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > quem já possui imóvel ou já financiou cai fora dos programas 1ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > escolhe a linha de melhor parecer; empate → prioridade 1ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > nenhuma linha elegível → INVIAVEL com NO_ELIGIBLE_LINE 0ms
✓ |simulation| test/simulate.test.ts > enquadramento por linha (spec §4.7, RF-15) com o seed ILUSTRATIVO > renda informal gera alerta 1ms
✓ |simulation| test/simulate.test.ts > subsídio (RF-22, tabela) > aplica a faixa de renda e reduz a entrada 0ms
✓ |simulation| test/simulate.test.ts > subsídio (RF-22, tabela) > imóvel acima do teto do subsídio → sem subsídio 1ms
✓ |simulation| test/simulate.test.ts > sistema, Price e entrada total > Price: 1ª parcela = PMT do valor financiado e nunca passa da parcela máxima 0ms
✓ |simulation| test/simulate.test.ts > sistema, Price e entrada total > sistema não oferecido pela linha é trocado e sinalizado 0ms
✓ |simulation| test/simulate.test.ts > sistema, Price e entrada total > useFullDownPayment: usa toda a entrada e financia menos 0ms
✓ |simulation| test/simulate.test.ts > fluxo de pagamento da obra (RF-23, simples) > sinal + mensais + reforços somam exatamente a entrada; chaves = financiamento + FGTS + subsídio 1ms
✓ |simulation| test/simulate.test.ts > fluxo de pagamento da obra (RF-23, simples) > entrega no mês corrente → entrada toda no sinal 0ms
✓ |simulation| test/simulate.test.ts > fluxo de pagamento da obra (RF-23, simples) > mensal da obra acima da capacidade gera alerta 0ms
✓ |simulation| test/simulate.test.ts > fluxo de pagamento da obra (RF-23, simples) > entrega anterior à data da simulação é inválida 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > determinístico e sem mutar a entrada 1ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros fora da vigência → erro (nunca simula com tabela vencida) 1ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: renda zero 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: dívida negativa 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: entrada negativa 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: valor do imóvel zero 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: data inexistente 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: tipo de renda fora da lista 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > entrada inválida: renda NaN 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros inválidos: cota acima de 100% 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros inválidos: prazo mínimo > máximo 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros inválidos: faixas de MIP fora de ordem 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros inválidos: ids repetidos 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > parâmetros inválidos: sem linhas 0ms
✓ |simulation| test/simulate.test.ts > pureza, validação e vigência > seed ILUSTRATIVO é válido e marcado como tal 1ms
[desempenho] 100 simulações: 76.2 ms (0.762 ms cada)
✓ |simulation| test/performance.test.ts > desempenho > uma simulação completa (3 linhas, cronogramas de até 420 meses) leva < 1 s 4ms
✓ |simulation| test/performance.test.ts > desempenho > 100 simulações seguidas em < 1 s (folga para concorrência) 77ms
Test Files  4 passed (4)
Tests  100 passed (100)
```

### Gerador de referência (Python, independente)
```
$ python3 -I packages/simulation/reference/generate_reference.py
16 casos gerados
```
Rodei de novo depois dos commits e os fixtures saíram idênticos (o gerador é reproduzível). O CSV resumido (colunas `id; taxa_anual; p1_total; ultima_total; total_pago; valor_max_financiavel`):
```
price-livro-100k-1pct-12;0.12;8884.88;8884.88;106618.55;100000.01
sac-livro-120k-1pct-12;0.12;11200.0;10100.0;127800.0;120000.0
price-taxa-zero;0;1000.0;1000.0;60000.0;60000.0
sac-taxa-zero;0;1000.0;1000.0;60000.0;60000.0
price-sbpe-300k-360;0.1149;2931.69;2890.08;1051396.51;327927.96
sac-sbpe-300k-360;0.1149;3656.31;890.54;818432.75;262045.87
...
```

### A suíte pega erro real (teste de mutação manual)
Troquei de propósito o MIP para incidir sobre o saldo **depois** da amortização (erro sutil e plausível) e rodei a suíte:
```
 Test Files  1 failed | 3 passed (4)
      Tests  15 failed | 85 passed (100)
```
Reverti (`git checkout`) e a suíte voltou a `Tests 100 passed (100)`.

### CLI (validação isolada)
```
$ pnpm --filter @mvp/simulation simulate packages/simulation/examples/lead-exemplo.json
→ VIAVEL programa-habitacional-faixa-a shortfall 0
$ pnpm --filter @mvp/simulation simulate /tmp/bad.json      # entrada incompleta
entrada de simulação inválida: propertyValue: Invalid input: expected number, received undefined; applicant: ...
exit=1
```

## Critérios de aceite da Fase 1

| Critério (docs/04-plano.md) | Resultado |
|---|---|
| Testes unitários com casos de referência (planilha calculada à parte) para SAC e Price | **OK.** 16 casos em Python decimal + 3 de livro-texto. Batem centavo a centavo em 1ª parcela (cada componente), última parcela, totais e teto de financiamento. |
| Casos de borda: parcela_max ≤ 0 | **OK.** = 0, < 0 e "não cobre nem seguros/taxas" → `INVIAVEL` / `NO_PAYMENT_CAPACITY`. |
| Casos de borda: idade | **OK.** Idade limita o prazo (alerta), limite exato no prazo mínimo; nascido um dia antes → `AGE_LIMIT`, regra OLDEST/YOUNGEST, menor de 18 → erro de entrada. |
| Casos de borda: cota | **OK.** Cota limita, cota alterada por parâmetro muda o resultado, cota 100%, financiável = MIN(cota, parcela) em várias rendas. |
| Cálculo < 1 s | **OK.** 2,67 ms (fria); 0,76 ms em média em 100 seguidas. |
| Parâmetros injetados (sem hardcode); seed ILUSTRATIVO | **OK.** Todo valor de negócio vem do JSON validado por Zod; há testes que mudam parâmetros e veem o resultado mudar. |

## O que ficou NÃO verificado e como o usuário valida

| Item | Por quê | Como validar |
|---|---|---|
| **Conferência com a planilha oficial do financeiro** (spec §13: "conferem com planilha de referência da área financeira") | A planilha não existe ainda (pendência externa do plano). A referência atual é interna. | Entregar `packages/simulation/reference/reference-cases.csv` ao financeiro. Ele confere na planilha dele, ou manda os casos dele, que viram `test/fixtures/financeiro.json` no mesmo formato e entram sozinhos em `pnpm test`. |
| **Convenções bancárias** que mudam número: MIP sobre o saldo antes do pagamento; MIP fixo pela idade na assinatura; seguros dentro do limite de comprometimento; taxa nominal × efetiva por linha; arredondamento meio para cima | São escolhas razoáveis, mas cada banco tem a sua. | Perguntas objetivas ao financeiro (lista acima). Cada uma é um parâmetro ou uma linha de código isolada. |
| **Valores do seed** (taxas, faixas, subsídios, cotas, idade máx., tempo de FGTS) | São **inventados** e marcados `ILUSTRATIVO`. | O financeiro preenche `seed/illustrative-parameters.json`, ou a tabela da Fase 2, e muda `status` para `VALIDADO`. |
| Fluxo de obra real do empreendimento (spec §16.8) | Não há tabela. O modelo é sinal % + reforços % a cada N meses + mensais iguais. | Comparar com a tabela de vendas de um empreendimento real. Se houver regras diferentes (ex.: mensais com correção pelo INCC), isso vira evolução. |

## Riscos e observações

- **Não modelado e relevante para o número final:** correção monetária do saldo (TR no SFH/SBPE), correção da entrada pelo INCC durante a obra, juros de obra, FGTS na amortização e reajuste do MIP por idade. A simulação é **indicativa** (spec §4.8). O orquestrador deve sempre exibir o aviso legal, e o alerta `ILLUSTRATIVE_PARAMETERS` precisa barrar o uso com lead real enquanto o status não for `VALIDADO`. Sugiro que a Fase 2/5 recuse parâmetros `ILUSTRATIVO` com `NODE_ENV=production`.
- **Precisão:** `number` (double) com limpeza de ruído. Foi validado contra decimal de 50 dígitos em valores de até R$ 1 milhão e 420 meses. Para valores muito maiores, a margem de 15 dígitos significativos ainda cobre centavos até ~R$ 10 bilhões.
- O alerta `FGTS_MIN_TIME_NOT_MET` pode sair duas vezes quando os dois proponentes não cumprem o tempo mínimo (cosmético; os templates devem deduplicar).
- O motor ainda **não é usado pelo bot**: a integração é das Fases 5–6. O bundle do bot não mudou.
- O commit `20a50cb` sozinho não passa nos testes: o teste de amortização importa `src/index.ts`, que só entrou em `7fa3366`. O `HEAD` está verde. Isso só importa para quem fizer `git bisect`.
- Disco do host: 3,5 GB livres no início da fase (era ~775 MB no fim da Fase 0). Esta fase não usou Docker.

## Estado deixado
- `main` com 2 commits de implementação + este relatório; nada enviado (sem push).
- Nenhum segredo foi adicionado. O código do WA-AKG não foi tocado. Docker e Ollama não foram usados nesta fase.
