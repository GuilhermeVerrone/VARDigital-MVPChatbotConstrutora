import { Prisma } from './generated/prisma/client';

// Conversões entre os tipos do banco (Decimal, @db.Date) e os do motor (number, 'AAAA-MM-DD').

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' → Date à meia-noite UTC (formato que o Prisma usa para colunas @db.Date). */
export function dateFromIso(iso: string): Date {
  const m = ISO_DATE.exec(iso);
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(NaN);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new RangeError(`data inválida: ${iso} (esperado AAAA-MM-DD)`);
  }
  return date;
}

export function isoFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = dateFromIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoFromDate(d);
}

/** Data civil de hoje no fuso da operação (America/Sao_Paulo), em 'AAAA-MM-DD'. */
export function todayIso(now: Date = new Date(), timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function num(value: Prisma.Decimal): number;
export function num(value: Prisma.Decimal | null): number | null;
export function num(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

/** Json nulo em coluna nullable precisa do sentinel do Prisma. */
export function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
