# V2 · 05 — Roteiro de demonstração

Para quem apresenta a demo da Elevare ao cliente (construtora). Duração: 25 a 30 minutos. Tudo que aparece é **ILUSTRATIVO** (empreendimentos, preços, condições e taxas do seed): diga isso na abertura e não prometa valor real.

O mesmo roteiro está automatizado em [`e2e/`](../../e2e/) (`pnpm test:e2e`): se ele passa, o caminho do site ao painel funciona. Rode antes de cada apresentação no ambiente de ensaio.

## Antes de começar (15 min antes)

1. **Zerar a demo.** No servidor da demo, com os apps parados no que escreve no banco (ou logo antes de abrir):
   ```bash
   APP_ENV=demo BOT_DATABASE_URL=<url> pnpm --filter @mvp/db demo-reset -- --yes
   ```
   Apaga leads, conversas, simulações, filas, versões publicadas, usuários e auditoria, e refaz o seed (3 empreendimentos, condições vigentes, corretores fictícios e o admin de demo). A senha do admin vem de `DEMO_ADMIN_PASSWORD` (padrão do seed: `elevare-demo-2026`; troque no ambiente publicado). O comando recusa rodar sem `APP_ENV=demo|development|test` e com `APP_ENV=production`.
2. **Conferir o WhatsApp.** Painel → *WhatsApp* → "Conectado". Se aparecer "Desconectado", leia o QR no WA-AKG (número dedicado da demo, nunca o principal).
3. **Telefones.** O número do celular de quem vai fazer o papel de lead e os dos corretores da demo precisam estar em `ALLOWED_PHONES` (fora dela o bot não envia nem responde). Corretores do seed têm DDD 00 (fictícios): cadastre o número real de quem vai "receber o card" em *Corretores* e acrescente-o em `ALLOWED_PHONES`.
4. **Abrir três janelas:** o site, o painel logado como admin (*Leads* aberto) e o WhatsApp do lead (celular ou WhatsApp Web).
5. **Janela de horário do 1º contato** (`FIRST_CONTACT_START/END/DAYS`): fora do horário comercial o bot espera. Para ensaiar de noite, amplie a janela no `.env` e suba o bot de novo; volte ao normal depois.

## Roteiro (ordem das telas)

| # | Tela | O que mostrar | Fala-chave |
|---|---|---|---|
| 1 | Site, home | Os três empreendimentos, preço "a partir de" vindo do banco | "O preço e o status vêm do cadastro, não do HTML." |
| 2 | Site, página do empreendimento | Plantas, galeria, formulário "Simule sua condição" | "Consentimento e opt-in vêm desmarcados; sem os dois o formulário não envia." |
| 3 | Formulário → obrigado | Preencher com o número do lead. A tela mostra o código `ELV-xxxx` e o botão do WhatsApp | "Reenviar o formulário não cria outro lead nem outra mensagem." |
| 4 | WhatsApp do lead | Chega o 1º contato em até 1 minuto. Responder **sim** | "O 'sim' é o segundo aceite (double opt-in). Quem veio do formulário não responde nome, telefone nem consentimento de novo." |
| 5 | WhatsApp, conversa | Uma das três personas abaixo | Mostre que os números vêm do motor (o texto explica a conta). |
| 6 | Painel, *Início* | Funil formulário → contato confirmado → simulação → corretor | "Cada etapa conta quem chegou nela." |
| 7 | Painel, *Leads* → o lead | Conversa, simulação, **plano da entrada**, consentimento com o texto aceito, histórico de status, PDF | "É a mesma simulação que o corretor recebeu." |
| 8 | WhatsApp do corretor | Card com modo de pagamento e plano da entrada + PDF | "O corretor liga já sabendo o plano." |
| 9 | Painel, *Empreendimentos → Condições* | Publicar uma condição nova (ex.: ato menor) com a prévia ao lado | "Muda a próxima simulação do bot, sem deploy." |
| 10 | WhatsApp | Um novo lead (outro telefone da lista) refaz a persona 3 e o plano muda | Fecha o ciclo da regra comercial. |
| 11 | Painel, *Fluxo do bot* | Editar um texto, ver o linter recusar "garantido", publicar, reverter | "Texto jurídico fica travado; o resto o time ajusta." |
| 12 | Painel, *Auditoria* | Tudo que foi feito, com o usuário | "Toda alteração aparece aqui." |

## Personas prontas (uma por forma de pagamento)

Todas começam igual: formulário no **Lumen Urban** → **sim** ao 1º contato. As respostas abaixo são as do ensaio automatizado; o bot aceita variações em texto livre.

| Persona | Modo | Respostas depois do "sim" |
|---|---|---|
| **Ana Souza**, quer pagar tudo de uma vez | 1 · à vista | `1` (tipologia) → `1` (à vista) → `sim`. O resultado traz desconto à vista e total a pagar; o bot oferece o corretor. |
| **Bruno Lima**, tem 120 mil e financia o saldo | 2 · entrada de uma vez + financiamento | `1` → `2` → `120 mil` → renda `9 mil` → `clt` → nascimento `05/03/1990` → dívidas `não` → co-proponente `não` → FGTS `não` → imóvel `não` → primeiro financiamento `sim` → `sim` (confirma). Resultado com entrada e estimativa do financiamento do saldo. |
| **Carla Dias**, quer parcelar a entrada com a construtora | 3 · entrada parcelada | `1` → `3` → renda `9 mil` → `clt` → `05/03/1990` → `não` → `não` → ato `30 mil` → mensal `2 mil` → `sim` → FGTS `não` → imóvel `não` → primeiro financiamento `sim` → `sim`. Resultado com ato, mensais, reforços e saldo nas chaves. |

Dica: mostre os três na ordem 1 → 3 → 2, ou só o 3 (o mais rico) se o tempo apertar.

## Plano B: o WhatsApp falhou

Sinais: painel *WhatsApp* ≠ "Conectado", mensagem do 1º contato não chega em 2 minutos, ou o celular do lead sem sinal.

1. Não insista no reenvio na frente do cliente. Diga: "o WhatsApp é um canal não oficial e eu tenho o mesmo motor aqui".
2. Painel → **Simulador de conversa**. Escolha a versão publicada, "pelo WhatsApp" ou "pelo formulário" e o empreendimento. Percorra a mesma persona: é o mesmo código do bot e o mesmo cálculo, sem gravar lead nem usar LLM.
3. Para mostrar o lead no painel mesmo assim: o formulário do site continua criando o lead (a mensagem fica na fila e sai quando o WhatsApp voltar; é o teste "WA-AKG fora" do e2e).
4. O card do corretor e o PDF não aparecem no plano B; mostre o PDF pela tela do lead de um ensaio anterior (faça antes da apresentação uma simulação completa e deixe-a no painel: não rode o `demo-reset` depois dela).
5. Se o painel também cair: o runbook ([`06-runbook.md`](06-runbook.md)) tem o diagnóstico. Tenha à mão prints das telas 6, 7 e 8 de um ensaio.

## Depois da apresentação

- Apague os leads de teste: rode o `demo-reset` (ou peça a exclusão pelo painel, que também cria a pendência de limpeza do WA-AKG: `./scripts/wa-akg-erase.sh`).
- Se a janela do 1º contato foi ampliada, volte ao normal.
