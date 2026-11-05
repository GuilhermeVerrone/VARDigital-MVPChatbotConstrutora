import { buildCsp, newNonce } from '@mvp/ui';
import { NextResponse, type NextRequest } from 'next/server';

// CSP com nonce por requisição (o Next aplica o nonce aos próprios scripts). As páginas passam a ser
// renderizadas por requisição, o que também mantém preço e status sempre atuais.
export function proxy(req: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production' });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
