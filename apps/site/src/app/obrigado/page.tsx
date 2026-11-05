import type { Metadata } from 'next';
import Link from 'next/link';
import { whatsappNumber } from '@/lib/server';

export const metadata: Metadata = { title: 'Pedido recebido', robots: { index: false } };

type Props = { searchParams: Promise<{ c?: string; e?: string }> };

const CODE_RE = /^ELV-\d{4,6}$/;

export default async function ThanksPage({ searchParams }: Props) {
  const { c } = await searchParams;
  const code = c && CODE_RE.test(c) ? c : null;
  const number = whatsappNumber();
  const text = code ? `Oi! Quero minha simulação da Elevare (${code})` : 'Oi! Quero minha simulação da Elevare';
  const href = number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;

  return (
    <section className="thanks">
      <div className="wrap prose">
        <span className="mark-bar" />
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.6rem)' }}>Recebemos o seu pedido.</h1>
        <p className="lead" style={{ marginTop: 20 }}>
          Em instantes você recebe uma mensagem nossa no WhatsApp. É só responder <strong>sim</strong> para começarmos.
        </p>
        {code ? (
          <>
            <p className="muted" style={{ marginBottom: 0 }}>Seu código:</p>
            <p className="code" aria-label={`Código ${code}`}>{code}</p>
          </>
        ) : null}
        {href ? (
          <>
            <p>Prefere começar agora? Chame a gente você mesmo:</p>
            <div className="actions" style={{ marginTop: 0 }}>
              <a className="btn" href={href} target="_blank" rel="noopener noreferrer">Abrir o WhatsApp</a>
              <Link className="btn ghost" href="/">Voltar ao início</Link>
            </div>
            <p className="muted small" style={{ marginTop: 20 }}>A mensagem já vai com o seu código, para a gente encontrar o seu pedido.</p>
          </>
        ) : (
          <div className="actions"><Link className="btn ghost" href="/">Voltar ao início</Link></div>
        )}
      </div>
    </section>
  );
}
