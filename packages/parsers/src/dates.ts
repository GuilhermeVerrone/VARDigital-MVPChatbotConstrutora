import { normalize } from './text';

const MONTHS: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
  julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, sete: 9, outubro: 10, out: 10, novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export interface DateOptions {
  /** Hoje (AAAA-MM-DD): limita datas futuras e resolve ano com 2 dígitos. */
  today?: string;
}

function todayIso(opts?: DateOptions): string {
  return opts?.today ?? new Date().toISOString().slice(0, 10);
}

function build(day: number, month: number, year: number, today: string): string | null {
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso > today ? null : iso;
}

function fullYear(y: string, today: string): number {
  if (y.length === 4) return Number(y);
  const pivot = Number(today.slice(2, 4));
  const n = Number(y);
  return (n > pivot ? 1900 : 2000) + n;
}

/**
 * Data (dia primeiro, formato BR) a partir de texto livre → AAAA-MM-DD. `null` se não houver
 * exatamente uma data válida e não futura.
 */
export function parseDate(text: string, opts?: DateOptions): string | null {
  const today = todayIso(opts);
  const norm = normalize(text);
  const found = new Set<string>();

  // ISO: 1990-03-05
  for (const m of norm.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const iso = build(Number(m[3]), Number(m[2]), Number(m[1]), today);
    if (iso) found.add(iso);
  }
  const withoutIso = norm.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');

  // 05/03/1990, 5-3-90, 05.03.1990, 5 3 1990
  for (const m of withoutIso.matchAll(/(?<!\d)(\d{1,2})\s?[/\-. ]\s?(\d{1,2})\s?[/\-. ]\s?(\d{4}|\d{2})(?!\d)/g)) {
    const iso = build(Number(m[1]), Number(m[2]), fullYear(m[3]!, today), today);
    found.add(iso ?? `invalid:${m[0]}`);
  }
  // 05031990
  for (const m of withoutIso.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{4})(?!\d)/g)) {
    const iso = build(Number(m[1]), Number(m[2]), Number(m[3]), today);
    found.add(iso ?? `invalid:${m[0]}`);
  }
  // 5 de março de 1990, 5 mar 90
  for (const m of withoutIso.matchAll(/(?<!\d)(\d{1,2})\s*(?:o\s+)?(?:de\s+)?([a-z]{3,9})\s*(?:de\s+|del\s+)?(\d{4}|\d{2})(?!\d)/g)) {
    const month = MONTHS[m[2]!];
    if (!month) continue;
    const iso = build(Number(m[1]), month, fullYear(m[3]!, today), today);
    found.add(iso ?? `invalid:${m[0]}`);
  }

  if (found.size !== 1) return null;
  const [only] = found;
  return only && !only.startsWith('invalid:') ? only : null;
}
