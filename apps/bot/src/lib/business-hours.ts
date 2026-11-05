// Janela de horário do 1º contato (Fase 13): o bot só escreve primeiro a quem preencheu o formulário
// dentro do horário comercial. Fora dele o job espera a próxima abertura (não é falha).

export interface BusinessWindow {
  /** Minutos desde 00:00 no fuso (ex.: 8 h = 480). */
  startMin: number;
  /** Fim exclusivo, em minutos desde 00:00. */
  endMin: number;
  /** Dias da semana permitidos, 0 = domingo ... 6 = sábado. */
  days: readonly number[];
  /** Fuso IANA (padrão America/Sao_Paulo). */
  timeZone: string;
}

/** "08:00" → 480. */
export function parseClock(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new Error(`horário inválido: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "1-6" ou "1,2,3,4,5" → [1..6]. */
export function parseDays(v: string): number[] {
  const out = new Set<number>();
  for (const part of v.split(',').map((p) => p.trim()).filter(Boolean)) {
    const r = /^([0-6])-([0-6])$/.exec(part);
    if (r) for (let d = Number(r[1]); d <= Number(r[2]); d++) out.add(d);
    else if (/^[0-6]$/.test(part)) out.add(Number(part));
    else throw new Error(`dias inválidos: ${v}`);
  }
  if (out.size === 0) throw new Error('informe pelo menos um dia da semana');
  return [...out].sort();
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: WEEKDAYS[parts.weekday!]!,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    y: Number(parts.year), mo: Number(parts.month), d: Number(parts.day),
  };
}

export function isWithinWindow(at: Date, w: BusinessWindow): boolean {
  const p = localParts(at, w.timeZone);
  return w.days.includes(p.weekday) && p.minutes >= w.startMin && p.minutes < w.endMin;
}

/** Próximo instante em que a janela abre (o próprio `at` se já estiver aberta). */
export function nextWindowOpening(at: Date, w: BusinessWindow): Date {
  if (isWithinWindow(at, w)) return at;
  const p = localParts(at, w.timeZone);
  // Diferença entre o relógio local e o UTC neste instante (sem horário de verão no Brasil; em fusos com
  // ele, o erro de no máximo 1 h é corrigido pela reavaliação do worker ao acordar).
  const offsetMs = Date.UTC(p.y, p.mo - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60) - Math.floor(at.getTime() / 60_000) * 60_000;
  for (let add = 0; add <= 7; add++) {
    const dayStart = Date.UTC(p.y, p.mo - 1, p.d + add) + w.startMin * 60_000 - offsetMs;
    const candidate = new Date(dayStart);
    if (candidate <= at) continue;
    if (w.days.includes((p.weekday + add) % 7)) return candidate;
  }
  throw new Error('janela de horário sem nenhum dia aberto');
}
