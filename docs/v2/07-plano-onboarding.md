# V2 · 07 — Site de vendas do ConstruBot (Fase 18)

Objetivo: um site para **vender** o produto a construtoras, que também serve de guia de uso depois da venda. Público: diretor ou gerente comercial de construtora, não técnico, que abre o link no celular.

## Decisões do usuário

- **Nome do produto:** ConstruBot. A Elevare continua só como construtora fictícia das telas e conversas.
- **Sem assunto técnico** no site.
- **Ação principal:** o visitante testa sozinho, com o próprio celular (site de exemplo + WhatsApp da demonstração). O painel aparece por prints: um painel aberto mostraria dados de outros visitantes.
- **Preço:** sob consulta.
- **Visual:** "Tapume de obra", escolhido na página de decisão da skill de design (tapume pintado, placa de obra, visores com o produto funcionando).

## O que o site tem (`apps/vitrine`)

- **Página principal:** promessa com a conversa real tocando, o problema, como funciona em 4 passos, as 3 formas de pagamento (conversas reais), o que o corretor recebe (PDF real), o painel (8 telas), privacidade e implantação, teste com o celular, dúvidas e fecho.
- **Funcionalidades** (`/funcionalidades/`): 16 seções, cada uma com quem usa, passo a passo e prints ou conversa real.
- **Teste com o seu celular** (`/testar/`): roteiro de 12 etapas com marcas "feito" e "parei aqui", guardadas no navegador.

## Como a prova é feita

- `pnpm vitrine:capturas` sobe a stack do e2e, percorre o site e o painel e conversa com o bot como as personas de exemplo. Grava os prints em `apps/vitrine/public/produto/` e as conversas em `apps/vitrine/src/conteudo/conversas.json`. Nada é desenhado à mão.
- `e2e/tests/roteiro-vitrine.spec.ts` executa o roteiro de teste do site exatamente como está escrito. Se o atendimento mudar, o teste quebra.

## Lacunas do produto resolvidas na fase

- Tela de usuários (criar acessos de corretor e gerente).
- Troca de senha ("Minha conta") e aviso de senha provisória.
- Nota interna que aparecia no card do corretor.

## Publicação

Imagem estática `vitrine` (Caddy mínimo, 48 MB), atrás do Caddy da borda em `VITRINE_HOST` (padrão `vendas.<DOMAIN>`). Endereços da demonstração e contato de vendas entram no build pelas variáveis do repositório (`DEMO_SITE_URL`, `DEMO_WHATSAPP`, `VENDAS_WHATSAPP`, `VENDAS_EMAIL`). Detalhes no [runbook](06-runbook.md#site-de-vendas-construbot).
