import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Big_Shoulders_Stencil } from 'next/font/google';
import Link from 'next/link';
import { Icone, Marca } from '@/componentes/Icone';
import { PRODUTO } from '@/conteudo/config';
import './vitrine.css';

// Letreiro condensado de sinalização de obra, texto da mesma família e numerais de estêncil.
const letreiro = Barlow_Condensed({ subsets: ['latin'], weight: ['700', '800'], display: 'swap', variable: '--f-letreiro' });
const texto = Barlow({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--f-texto' });
const estencil = Big_Shoulders_Stencil({ subsets: ['latin'], weight: ['800'], display: 'swap', variable: '--f-estencil' });

export const metadata: Metadata = {
  title: { default: `${PRODUTO} · O lead chega ao corretor com a conta feita`, template: `%s · ${PRODUTO}` },
  description: `${PRODUTO} atende quem se interessa pelo seu lançamento no WhatsApp, faz a simulação nas formas de pagamento da sua construtora e entrega o lead pronto ao corretor.`,
  icons: { icon: '/marca.svg' },
};
export const viewport: Viewport = { themeColor: '#1f3fb0', width: 'device-width', initialScale: 1 };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${letreiro.variable} ${texto.variable} ${estencil.variable}`}>
      <body>
        <a className="pular" href="#conteudo">Ir para o conteúdo</a>
        <header className="topo">
          <div className="faixa">
            <Link className="marca" href="/" aria-label={`${PRODUTO}, página inicial`}>
              <Marca />
              {PRODUTO}
            </Link>
            <nav className="menu" aria-label="Principal">
              <Link className="so-largo" href="/#como-funciona">Como funciona</Link>
              <Link className="so-medio" href="/funcionalidades/">Funcionalidades</Link>
              <Link className="botao sinal pequeno" href="/testar/">Testar<Icone nome="seta" tamanho={18} /></Link>
            </nav>
          </div>
        </header>
        <div className="travessia" aria-hidden="true"><span className="travessia-marco" /></div>
        <main id="conteudo">{children}</main>
        <footer className="rodape">
          <div className="faixa">
            <p>
              <strong>{PRODUTO}</strong>. As telas e conversas deste site são reais, feitas com a Elevare Construtora, uma construtora
              fictícia criada para a demonstração: empreendimentos, preços, condições e pessoas são de exemplo. A simulação do {PRODUTO} é
              indicativa: não é proposta, não reserva a unidade e não aprova crédito.
            </p>
            <nav aria-label="Rodapé">
              <Link href="/#como-funciona">Como funciona</Link>
              <Link href="/funcionalidades/">Funcionalidades</Link>
              <Link href="/testar/">Testar</Link>
              <Link href="/#duvidas">Dúvidas</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
