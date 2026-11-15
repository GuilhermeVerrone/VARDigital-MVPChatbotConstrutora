// Tudo o que muda de uma implantação para outra fica aqui: nome do produto, endereços da demonstração e
// contato de vendas. Os endereços vêm do ambiente na hora do build (NEXT_PUBLIC_*); sem eles, os botões
// que dependem deles não aparecem (nenhum botão que não leva a lugar nenhum).

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

/** Link para o site de exemplo; null enquanto o endereço não está configurado. */
export const demoSiteHref = (path = '/empreendimentos/lumen-urban'): string | null => (DEMO_SITE_URL ? `${DEMO_SITE_URL.replace(/\/$/, '')}${path}` : null);
export const demoWhatsappHref = (): string | null => (DEMO_WHATSAPP ? waLink(DEMO_WHATSAPP, 'Oi! Vi o anúncio do Lumen Urban') : null);
export const vendasHref = (): string | null =>
  VENDAS_WHATSAPP ? waLink(VENDAS_WHATSAPP, `Oi! Quero conversar sobre o ${PRODUTO}.`) : VENDAS_EMAIL ? `mailto:${VENDAS_EMAIL}` : null;
