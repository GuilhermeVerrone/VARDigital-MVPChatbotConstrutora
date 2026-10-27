// Datas civis no formato ISO 'AAAA-MM-DD', sem fuso horário: o motor nunca lê o relógio;
// a data de referência da simulação é sempre injetada.

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDate(value: string): CivilDate {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`data inválida: ${value}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RangeError(`data inválida: ${value}`);
  }
  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Meses completos de `from` até `to` (negativo se `to` for anterior). */
export function fullMonthsBetween(from: string, to: string): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  const months = (b.year - a.year) * 12 + (b.month - a.month);
  if (months > 0 && b.day < a.day) return months - 1;
  if (months < 0 && b.day > a.day) return months + 1;
  return months;
}

/** Idade em meses completos na data de referência. */
export function ageInMonths(birthDate: string, referenceDate: string): number {
  return fullMonthsBetween(birthDate, referenceDate);
}

export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
