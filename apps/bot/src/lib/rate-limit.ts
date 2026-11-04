/**
 * Limite de mensagens por conversa em janela deslizante. Protege a fila e o LLM local de quem
 * dispara mensagens em rajada (loop, colagem repetida, abuso). Em memória: reiniciar zera, o que
 * basta para um processo só.
 */
export interface RateLimiter {
  /** true = pode seguir; false = estourou o limite da janela (a mensagem não conta). */
  allow(key: string): boolean;
}

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();

  return {
    allow(key) {
      if (opts.max <= 0) return true;
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      // Faxina: chaves antigas não se acumulam.
      if (hits.size > 5_000) for (const [k, v] of hits) if (v.every((at) => t - at >= opts.windowMs)) hits.delete(k);
      return true;
    },
  };
}
