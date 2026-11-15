'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** Abas acessíveis (setas, Home, End) com o visual definido por quem usa. */
export function useAbas(total: number) {
  const [atual, setAtual] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ir = (i: number) => {
    const n = (i + total) % total;
    setAtual(n);
    refs.current[n]?.focus();
  };
  const teclado = (e: KeyboardEvent) => {
    const mapa: Record<string, number> = { ArrowDown: atual + 1, ArrowRight: atual + 1, ArrowUp: atual - 1, ArrowLeft: atual - 1, Home: 0, End: total - 1 };
    const destino = mapa[e.key];
    if (destino === undefined) return;
    e.preventDefault();
    ir(destino);
  };
  const aba = (i: number) => ({
    ref: (el: HTMLButtonElement | null) => { refs.current[i] = el; },
    id: `${base}-aba-${i}`,
    role: 'tab' as const,
    type: 'button' as const,
    'aria-selected': atual === i,
    'aria-controls': `${base}-painel`,
    tabIndex: atual === i ? 0 : -1,
    onClick: () => setAtual(i),
    onKeyDown: teclado,
  });
  const painel = { id: `${base}-painel`, role: 'tabpanel' as const, 'aria-labelledby': `${base}-aba-${atual}` };
  return { atual, aba, painel };
}

export function ListaDeAbas({ rotulo, children, className }: { rotulo: string; children: ReactNode; className?: string }) {
  return <div role="tablist" aria-label={rotulo} aria-orientation="vertical" className={className}>{children}</div>;
}
