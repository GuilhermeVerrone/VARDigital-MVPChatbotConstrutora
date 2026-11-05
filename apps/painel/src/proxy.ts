import { buildCsp, newNonce } from '@mvp/ui';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/auth';
import { isPublicPath } from './lib/permissions';

// Primeira barreira: sem cookie de sessão, nada além do login. A validade da sessão e o papel são
// conferidos no servidor, em cada página e em cada ação (requirePage / requireAction / serviços).
// Também define a CSP com nonce por requisição (o Next aplica o nonce aos próprios scripts).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isPublicPath(pathname) && !req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.redirect(new URL('/login', req.url));

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
