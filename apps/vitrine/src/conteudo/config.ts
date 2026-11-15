// Tudo o que muda de uma implantação para outra fica aqui: nome do produto, endereços da demonstração e
// contato de vendas. Os endereços vêm do ambiente na hora do build (NEXT_PUBLIC_*); sem eles, o site
// mostra os botões apontando para a seção de teste, sem link quebrado.

export const PRODUTO = 'ConstruBot';

/** Site de exemplo da construtora fictícia (onde o visitante preenche o formulário). */
export const DEMO_SITE_URL = process.env.NEXT_PUBLIC_DEMO_SITE_URL ?? '';
/** Número de WhatsApp da demonstração, só dígitos com DDI (ex.: 5541999990000). */
export const DEMO_WHATSAPP = process.env.NEXT_PUBLIC_DEMO_WHATSAPP ?? '';
/** WhatsApp de vendas do ConstruBot, só dígitos com DDI. */
export const VENDAS_WHATSAPP = process.env.NEXT_PUBLIC_VENDAS_WHATSAPP ?? '';
/** E-mail de vendas. */
export const VENDAS_EMAIL = process.env.NEXT_PUBLIC_VENDAS_EMAIL ?? '';

export const waLink = (digits: string, text?: string): string =>
  `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Link para o site de exemplo, ou a seção de teste quando ainda não há endereço. */
export const demoSiteHref = (path = '/empreendimentos/lumen-urban'): string => (DEMO_SITE_URL ? `${DEMO_SITE_URL}${path}` : '/testar/');
export const demoWhatsappHref = (): string => (DEMO_WHATSAPP ? waLink(DEMO_WHATSAPP, 'Oi! Vi o anúncio do Lumen Urban') : '/testar/');
export const vendasHref = (): string =>
  VENDAS_WHATSAPP ? waLink(VENDAS_WHATSAPP, `Oi! Quero conversar sobre o ${PRODUTO}.`) : VENDAS_EMAIL ? `mailto:${VENDAS_EMAIL}` : '/testar/';
