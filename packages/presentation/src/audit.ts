/**
 * Auditoria de números (spec §9.2, §13): nenhum valor mostrado ao lead ou ao corretor pode vir
 * de outra fonte além do motor e do que o lead informou. `unexplainedNumbers` acha os números de
 * um texto que não aparecem na(s) fonte(s) fornecida(s).
 */

/** Todos os números de uma estrutura JSON, mais as formas derivadas que as mensagens mostram. */
export function collectNumbers(source: unknown, into: Set<number> = new Set()): Set<number> {
  const add = (n: number) => {
    into.add(round2(n));
    // Razões (0 a 1) aparecem como percentual inteiro; meses como anos.
    if (n > 0 && n <= 1) into.add(Math.round(n * 100));
    if (Number.isInteger(n) && n % 12 === 0) into.add(n / 12);
  };
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) add(v);
    else if (typeof v === 'string') {
      // Datas ISO viram dia, mês e ano, nas formas que o texto usa.
      for (const m of v.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) [m[1], m[2], m[3]].forEach((p) => into.add(Number(p)));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(source);
  return into;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Números do texto (ignorando data e hora de geração) que não estão em `allowed`. */
export function unexplainedNumbers(text: string, allowed: Set<number>, extraAllowed: number[] = []): string[] {
  const ok = new Set([...allowed, ...extraAllowed.map(round2)]);
  const cleaned = text
    .replace(/\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/g, '') // data e hora da geração
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ''); // ids
  const bad: string[] = [];
  for (const m of cleaned.matchAll(/\d+(?:\.\d{3})*(?:,\d+)?/g)) {
    const raw = m[0];
    // "219.000" (milhar) e "1.234,56" (decimal) → número; "42,5" → 42.5
    const value = Number(raw.replace(/\./g, '').replace(',', '.'));
    // Datas "MM/AAAA" e "DD/MM/AAAA": cada parte já entra pelas datas ISO da fonte.
    if (!Number.isFinite(value) || !ok.has(round2(value))) bad.push(raw);
  }
  return bad;
}
