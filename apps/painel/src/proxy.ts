import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from './lib/auth';
import { isPublicPath } from './lib/permissions';

// Primeira barreira: sem cookie de sessão, nada além do login. A validade da sessão e o papel são
// conferidos no servidor, em cada página e em cada ação (requirePage / requireAction / serviços).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (!req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
