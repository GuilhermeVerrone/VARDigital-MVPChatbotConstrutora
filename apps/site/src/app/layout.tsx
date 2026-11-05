import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Image from 'next/image';
import Link from 'next/link';
import '@mvp/ui/tokens.css';
import '@mvp/ui/base.css';
import './site.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Elevare Construtora · Lumen Urban, Parc Verde e Altomare', template: '%s · Elevare Construtora' },
  description: 'Três empreendimentos residenciais da Elevare: Lumen Urban em Curitiba, Parc Verde em Campinas e Altomare em Balneário Camboriú. Simule sua condição de pagamento.',
  icons: { icon: '/logo/simbolo.svg' },
};
export const viewport: Viewport = { themeColor: '#0F3D36', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), var(--font)' }}>
        <a className="skip" href="#main">Ir para o conteúdo</a>
        <header className="site-header">
          <div className="wrap">
            <Link className="brand" href="/" aria-label="Elevare Construtora, página inicial">
              <Image src="/logo/logo-horizontal.svg" alt="Elevare Construtora" width={190} height={46} priority unoptimized />
            </Link>
            <nav className="nav" aria-label="Principal">
              <Link href="/#empreendimentos">Empreendimentos</Link>
              <Link href="/#sobre">Sobre</Link>
              <Link href="/#simule">Simule sua condição</Link>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-footer on-dark">
          <div className="wrap">
            <div>
              <Image src="/logo/logo-vertical-negativo.svg" alt="Elevare Construtora" width={120} height={120} style={{ height: 120, width: 'auto' }} unoptimized />
              <p className="muted small">Construímos para quem quer subir de nível, andar por andar.</p>
            </div>
            <div>
              <h4>Empreendimentos</h4>
              <ul>
                <li><Link href="/empreendimentos/lumen-urban">Lumen Urban</Link></li>
                <li><Link href="/empreendimentos/parc-verde">Parc Verde</Link></li>
                <li><Link href="/empreendimentos/altomare">Altomare</Link></li>
              </ul>
            </div>
            <div>
              <h4>Contato</h4>
              <ul>
                <li>+55 41 0000-0000</li>
                <li>contato@elevare.example</li>
                <li><Link href="/privacidade">Privacidade</Link></li>
              </ul>
            </div>
            <p className="legal">
              A Elevare Construtora, seus empreendimentos, plantas e imagens são fictícios e foram criados para fins de demonstração. Imagens ilustrativas. Valores
              ilustrativos, sujeitos a confirmação da construtora. Qualquer semelhança com empresas ou endereços reais é coincidência.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
