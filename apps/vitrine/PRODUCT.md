# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js (App Router) com exportação estática, no monorepo, ao lado de `apps/site` e `apps/painel`. Escolhido por reaproveitar a stack e publicar arquivos estáticos, sem processo a mais no servidor. O usuário pediu que o site não fale de assuntos técnicos.

## Users

Diretor ou gerente comercial (ou de marketing) de uma construtora/incorporadora que vende lançamentos imobiliários. Não técnico. Recebe o link pelo WhatsApp ou e-mail e abre primeiro no celular. Decide se vale testar e levar para a equipe. Depois da compra, a mesma equipe (gestor, gerente de vendas, corretores) usa as páginas de funcionalidades como guia de uso.

## Product Purpose

Vender o **ConstruBot**: um atendente no WhatsApp que recebe o interessado vindo do site ou do anúncio, faz a primeira simulação de compra da unidade e entrega o lead ao corretor já qualificado, com a simulação em PDF. A construtora ajusta preços, condições comerciais e textos do atendimento sozinha, por um painel.

Sucesso do site: o visitante entende o produto em menos de um minuto, vê ele funcionando (prints e conversas reais) e **testa sozinho** a demonstração.

## Positioning

Não é um chatbot genérico de perguntas e respostas: ele faz a conta de verdade da compra do imóvel, nas três formas que a construtora vende (à vista; entrada de uma vez + financiamento do saldo; entrada parcelada com a construtora + financiamento nas chaves), com as condições comerciais que a própria construtora publica, e entrega o resultado ao corretor antes da primeira ligação.

## Operating Context

- Jornada do comprador: site do empreendimento → formulário "Simule sua condição" → mensagem no WhatsApp → confirma o interesse → responde perguntas simples (renda, entrada, FGTS…) → recebe o resultado e o PDF → pode pedir para falar com um corretor. Também pode começar direto pelo WhatsApp.
- Jornada do corretor: recebe no WhatsApp um resumo do lead com a forma de pagamento, o plano da entrada, o próximo passo sugerido e o PDF; vê os próprios leads no painel; assume ou devolve a conversa.
- Jornada da gestão: painel com início (funil e leads do dia), leads, empreendimentos e unidades, condições comerciais com prévia, financiamento simulado, corretores, usuários, textos do atendimento, simulador de conversa, situação do WhatsApp e histórico de alterações.

## Capabilities and Constraints

- Simulação **indicativa**: não aprova crédito nem substitui o banco. O site nunca promete aprovação, taxa garantida ou valor final.
- Consentimento e opt-in desmarcados no formulário; confirmação no WhatsApp antes de seguir (duplo aceite); o comprador pode pedir a exclusão dos dados.
- Toda alteração no painel fica registrada com quem fez.
- Condições comerciais mudam a próxima simulação sem depender de programador.
- Sem conteúdo técnico no site (infraestrutura, servidores, IA, banco de dados, código).
- Preço: **sob consulta** (não aparece no site).
- Ação principal: **testar sozinho**. O visitante testa ao vivo o site de exemplo e o WhatsApp de demonstração com o próprio celular; o painel aparece por prints (um painel aberto mostraria dados de outros visitantes). Endereços da demonstração e contato de vendas ainda não definidos: configuráveis em um único lugar.

## Brand Commitments

- Nome do produto: **ConstruBot** (confirmado pelo usuário).
- Idioma: português do Brasil, tom direto e humano, de quem conhece o dia a dia de vendas de lançamento (plantão, stand, corretor, ato, chaves, entrada).
- "Elevare Construtora" é uma construtora **fictícia** usada só como exemplo nas telas e conversas; o site deixa claro que os dados são ilustrativos.
- O site de vendas tem identidade própria, distinta da Elevare.

## Evidence on Hand

- Prints reais do site de exemplo, do painel e do PDF: `apps/vitrine/public/produto/*.webp`, gerados por `pnpm vitrine:capturas` sobre a stack de testes com dados ilustrativos.
- Conversas reais do atendimento e o aviso ao corretor: `apps/vitrine/src/conteudo/conversas.json` (Ana, à vista; Bruno, entrada + financiamento; Carla, entrada parcelada; Davi, começo pelo WhatsApp).
- **Não existem**: clientes, depoimentos, números de resultado (conversão, tempo economizado), selos ou imprensa. Nada disso pode ser inventado.

## Product Principles

1. Mostrar, não prometer: cada afirmação vem acompanhada do produto funcionando.
2. Falar a língua da venda de lançamento, nunca a da tecnologia.
3. Honestidade sobre o limite: simulação indicativa, decisão final do banco e do corretor.
4. O corretor continua no centro: o produto prepara, o corretor fecha.
5. A construtora no controle das próprias regras.

## Accessibility & Inclusion

WCAG 2.2 AA. Leitura confortável no celular (primeiro acesso via link no WhatsApp). Texto real, não imagem, nas conversas e nos números.
