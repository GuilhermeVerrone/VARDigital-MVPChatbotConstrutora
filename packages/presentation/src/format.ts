const TIME_ZONE = 'America/Sao_Paulo';

export const brl = (v: number): string =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** 0,2834 → "28%". */
export const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export const areaM2 = (v: number): string => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`;

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
export const dateBr = (iso: string): string => iso.split('-').reverse().join('/');

/** 'AAAA-MM-DD' → 'MM/AAAA'. */
export const monthYear = (iso: string): string => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** "30/10/2026 às 14:52", no fuso de São Paulo. */
export function dateTimeBr(d: Date): string {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} às ${p.hour}:${p.minute}`;
}

export function phoneBr(e164: string): string {
  const n = e164.replace(/^55/, '');
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
}

/** 360 → "360 meses (30 anos)". */
export function termText(months: number): string {
  return months % 12 === 0 ? `${months} meses (${months / 12} anos)` : `${months} meses`;
}

/** [12, 24] → "12 e 24"; [12, 24, 36] → "12, 24 e 36". */
export function joinList(items: (string | number)[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export const firstName = (name: string | null): string | null => name?.trim().split(/\s+/)[0] ?? null;

/** Idade em anos completos na data de referência. */
export function ageYears(birthIso: string, refIso: string): number {
  const [by, bm, bd] = birthIso.split('-').map(Number) as [number, number, number];
  const [ry, rm, rd] = refIso.split('-').map(Number) as [number, number, number];
  return ry - by - (rm < bm || (rm === bm && rd < bd) ? 1 : 0);
}

export const INCOME_TYPE_LABEL: Record<string, string> = {
  CLT: 'CLT', AUTONOMO: 'autônomo', SERVIDOR: 'servidor', APOSENTADO: 'aposentado', OUTROS: 'outros',
};
