---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: []
---

## Escopo

Site de vendas do ConstruBot (apps/vitrine): página principal + páginas de funcionalidades. Modo: Persuade (a página principal); as páginas de funcionalidades são Read dentro do mesmo mundo.

## Público, ação e prova

Diretor comercial de construtora, no celular. Ação: testar sozinho (site de exemplo + WhatsApp de demonstração); painel por prints. Prova: prints reais e conversas reais (`public/produto`, `src/conteudo/conversas.json`). Preço sob consulta; nada de números, clientes ou depoimentos inventados.

## Direction contract

THESIS: o site é o tapume do lançamento ConstruBot: painéis pintados que anunciam a obra, com visores recortados por onde se espia o produto funcionando. Recusa o hero de software (título, print num cartão, faixa de ícones).

OWN-WORLD: tinta azul-cobalto chapada cobrindo mais da metade de cada tela; amarelo de sinalização e preto só na fita zebrada que emoldura visores e na ação principal; placa de obra em chapa clara com faixas e grade rígida de campos; caixilho de compensado com parafusos nos visores; letreiro condensado de sinalização pintado; numerais de estêncil.

STORY: em uma tela o diretor entende que o ConstruBot atende no WhatsApp, faz a conta das três formas de pagamento e entrega o lead pronto ao corretor; espia a prova pelos visores; testa sozinho.

FIRST VIEWPORT: tapume azul de ponta a ponta; à esquerda a promessa pintada em condensada enorme; à direita um visor com caixilho mostrando a conversa real da Carla chegando mensagem a mensagem; abaixo da promessa, a placa de obra (Atende, Faz a conta, Entrega) com o botão amarelo "Testar a demonstração".

FORM: Tapume de obra, 3º da lista ordenada, seed 1cc9a06f. Interação assinatura: visores que "tocam" a conversa real ao entrar na tela; linha de travessia do lead (interessado → pronto para o corretor) ao longo da rolagem. Raises: cor chapada em força total (Bolacha de jazz); estado como marca pintada no Teste você mesmo, lembrando onde parou (Mesa de corte); cada afirmação costurada à sua prova (Atlas de colcha); uma única linha de travessia (Disco de acreção).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Decisões em aberto

Endereços da demonstração e contato de vendas (configuráveis em `src/conteudo/config.ts`).
