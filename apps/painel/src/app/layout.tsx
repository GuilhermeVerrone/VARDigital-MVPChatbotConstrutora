import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@mvp/ui/tokens.css';
import './panel.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = { title: { default: 'Painel Elevare', template: '%s · Painel Elevare' }, robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: '#0F3D36', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), var(--font)' }}>{children}</body>
    </html>
  );
}
