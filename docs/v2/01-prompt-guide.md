# V2 · 01 — Prompt Guide

Data: 2026-11-04. Continuação do MVP (Fases 0–8, ver [`../04-plano.md`](../04-plano.md) e [`../06-check-projeto.md`](../06-check-projeto.md)).

**Objetivo da V2:** deixar a solução com cara de produto para uma simulação real com o cliente (construtora Elevare):

1. **Site de vendas** com formulário. O formulário gera o lead e dispara o primeiro contato pelo WhatsApp.
2. **Painel do chatbot.** Nele se configuram as etapas do fluxo, o motor de cálculo (condições comerciais), os empreendimentos e os leads.
3. **Motor com 3 formas de pagamento:**
   - **À vista.**
   - **Entrada à vista + financiamento.** Só tratamos até a entrada.
   - **Entrada parcelada direto com a construtora + financiamento.** Este é o foco: o motor monta o plano da entrada.

## Parte A — Guia de trabalho (Claude Code)

### Método (mesmo do MVP)
1. **Prompt Guide**: este documento.
2. **Discovery**: [`02-discovery.md`](02-discovery.md). Estado atual verificado no código, lacunas e decisões.
3. **Impactos**: [`03-impactos.md`](03-impactos.md). O que muda no spec, na arquitetura, nos dados, no risco e no esforço.
4. **Plano faseado**: [`04-plano.md`](04-plano.md). As fases continuam a numeração do MVP (9 em diante), cada uma com critério de aceite.
5. **Execução**: uma fase por vez. Relatório em `docs/fases/fase-N.md`.

### Regras herdadas (continuam valendo)
- Nunca pular etapa. Nunca começar uma fase sem o plano aprovado.
- O cálculo financeiro é **sempre código determinístico** com testes. O LLM nunca calcula.
- Regras financeiras e comerciais ficam em **tabelas versionadas com vigência e auditoria**, nunca no código.
- Nenhum segredo no repositório. Dados pessoais mascarados em logs. Consentimento antes de qualquer coleta.
- Decisões de negócio, jurídicas ou de risco são perguntadas ao usuário, não assumidas.
- Cada fase termina com `pnpm check` verde, um relatório da fase e a lista do que ficou pendente.

### Regras novas da V2
- **Um motor só.** O painel (prévia), o bot e o PDF usam o mesmo `packages/simulation`. Nenhum cálculo é duplicado no front-end.
- **Banco só no servidor.** Site e painel acessam o Postgres apenas por código de servidor (Server Actions ou rotas). Nada de Prisma, segredo ou dado pessoal no bundle do navegador.
- **Painel sempre autenticado e auditado.** Toda alteração de condição comercial, fluxo, empreendimento ou preço gera uma nova versão ou um registro em `audit_logs`, com o usuário real.
- **Textos editáveis com trava.** Os avisos legais e o texto de consentimento são blocos protegidos. O editor de fluxo valida as variáveis (`{nome}`, `{empreendimento}`…) e não deixa publicar texto que promete aprovação, taxa ou prazo.
- **Contato ativo só com opt-in.** O bot só escreve primeiro para quem marcou o opt-in no formulário. A primeira mensagem pede confirmação (*double opt-in*). Há limite por hora e janela de horário.
- **Identidade Elevare** em site e painel: as cores e a tipografia de `elevare-construtora/README.md`. Seguir as skills de front-end (`impeccable`, `shadcn`, `frontend-design`) e checar acessibilidade (`web-design-guidelines`).
- **Dados de demonstração** marcados `ILUSTRATIVO`. Um script reseta o ambiente de demo para o estado inicial.

### Template de prompt para pedir uma fase
```
Fase: <id e nome conforme docs/v2/04-plano.md>
Contexto: spec.md §<seções>, docs/v2/02-discovery.md, docs/v2/03-impactos.md §<itens>
Objetivo: <1 frase>
Entregáveis: <lista>
Fora de escopo: <lista>
Critério de aceite: <testes/comportamentos verificáveis>
Restrições: motor único e determinístico, banco só no servidor, auditoria, LGPD
Ao final: pnpm check, relatório em docs/fases/fase-N.md, arquivos alterados, riscos remanescentes.
```

### Convenções
- Código e identificadores em inglês. Textos ao lead, painel, site e docs em português (BR).
- Uma fase por branch (`v2/fase-N-<nome>`). Commits pequenos e só quando o usuário pedir.

## Parte B — Guia de prompts do LLM do bot (mudanças)

O papel do LLM continua estreito: **extrair e normalizar** a resposta e **ajudar no FAQ**. Tudo do Prompt Guide do MVP continua valendo. Mudanças:

0. **Provedor (D13):** o LLM passa a ser a API da Anthropic. Nada de nome, telefone ou e-mail vai na requisição, e o conteúdo das mensagens não vai para os logs. Continua valendo "parsers primeiro": o LLM só entra quando o parser falha.

1. Novo campo de extração `paymentMode` (`A_VISTA | ENTRADA_A_VISTA | ENTRADA_PARCELADA`). Exemplos de frases: "quero pagar tudo de uma vez", "tenho a entrada e financio o resto", "dá pra parcelar a entrada?".
2. Novo campo `acceptsBalloons` (sim/não para reforços semestrais ou anuais) e `cashNow` (dinheiro disponível para o ato).
3. Os textos do fluxo deixam de ser fixos no código e vêm do **FlowConfig** publicado no painel. O LLM nunca reescreve esses textos.
4. Prompt versionado como `prompts/extraction.v3.md`. A suíte de regressão ganha casos dos 3 modos.

## Parte C — Guia de tom das mensagens (ajustes.txt, item 4)
- Fale como um consultor da Elevare, não como um formulário. Use o primeiro nome do lead e frases curtas.
- **Uma pergunta por mensagem.** Uma confirmação curta e variada antes da próxima pergunta ("Anotado!", "Perfeito.", "Show, obrigado.").
- Valores sempre em `R$ 1.234,56`, vindos do motor. Os planos de pagamento vão em lista com quebras de linha e no máximo um emoji por mensagem.
- Use botões de resposta rápida quando o canal suportar. O texto alternativo ("responda 1, 2 ou 3") fica no rodapé, não na pergunta.
