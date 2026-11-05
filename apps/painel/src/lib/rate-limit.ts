// Limite por janela deslizante, em memória (instância única no piloto; com mais de uma, trocar por tabela).
export interface RateLimiter {
  hit(key: string, now?: number): boolean;
}

export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= opts.windowMs)) hits.delete(k);
      return true;
    },
  };
}
