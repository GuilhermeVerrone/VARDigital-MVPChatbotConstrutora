// Content-Security-Policy dos apps Next (site e painel). Uma política por requisição, com nonce:
// o Next lê o nonce do cabeçalho da requisição e o aplica aos próprios scripts. Sem 'unsafe-inline'
// em scripts; 'unsafe-eval' só em desenvolvimento (o React usa eval para as pilhas de depuração).
// Usa só a Web Crypto, então roda no runtime do proxy do Next.

export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

export interface CspOptions {
  /** Desenvolvimento: libera 'unsafe-eval' e o websocket do hot reload. */
  dev?: boolean;
  /** Origens extras para imagens (além de 'self', data: e blob:). */
  imgSrc?: string[];
}

export function buildCsp(nonce: string, opts: CspOptions = {}): string {
  const dev = opts.dev === true;
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Estilos de arquivo e com nonce; atributos style="" (React) ficam liberados só para atributos.
    'style-src': ["'self'", `'nonce-${nonce}'`],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...(opts.imgSrc ?? [])],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(dev ? ['ws:', 'http:'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(dev ? {} : { 'upgrade-insecure-requests': [] }),
  };
  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');
}
