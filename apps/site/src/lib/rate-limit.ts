// Limite por janela deslizante, em memória: o site roda em uma instância só (VPS do piloto). Com mais de
// uma, trocar por Redis ou por uma tabela. Chaves são hashes/valores curtos; nada fica em disco.

export interface RateLimiter {
  /** Registra uma tentativa e diz se ainda cabe no limite. */
  hit(key: string, now?: number): boolean;
}

/** `max <= 0` desliga o limite (útil em teste e demonstração). */
export function createRateLimiter(opts: { max: number; windowMs: number }): RateLimiter {
  if (opts.max <= 0) return { hit: () => true };
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
      // Limpeza preguiçosa para o mapa não crescer sem fim.
      if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= opts.windowMs)) hits.delete(k);
      return true;
    },
  };
}
