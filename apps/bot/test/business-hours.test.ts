import { describe, expect, it } from 'vitest';
import { isWithinWindow, nextWindowOpening, parseClock, parseDays, type BusinessWindow } from '../src/lib/business-hours';

const w: BusinessWindow = { startMin: parseClock('08:00'), endMin: parseClock('20:00'), days: parseDays('1-6'), timeZone: 'America/Sao_Paulo' };
// São Paulo = UTC-3. 2026-11-05 é quinta-feira.
const utc = (s: string) => new Date(s);

describe('janela de horário do 1º contato', () => {
  it('lê horários e dias', () => {
    expect(parseClock('08:30')).toBe(510);
    expect(parseDays('1-3,6')).toEqual([1, 2, 3, 6]);
    expect(() => parseClock('8h')).toThrow();
    expect(() => parseDays('9')).toThrow();
  });

  it('abre dentro do horário local, não do UTC', () => {
    expect(isWithinWindow(utc('2026-11-05T14:00:00Z'), w)).toBe(true); // 11:00 em SP
    expect(isWithinWindow(utc('2026-11-05T10:59:00Z'), w)).toBe(false); // 07:59 em SP
    expect(isWithinWindow(utc('2026-11-05T23:00:00Z'), w)).toBe(false); // 20:00 em SP (fim exclusivo)
    expect(isWithinWindow(utc('2026-11-08T15:00:00Z'), w)).toBe(false); // domingo
  });

  it('devolve o próprio instante quando já está aberto', () => {
    const at = utc('2026-11-05T14:00:00Z');
    expect(nextWindowOpening(at, w).toISOString()).toBe(at.toISOString());
  });

  it('antes da abertura espera o mesmo dia; depois do fechamento, o dia seguinte', () => {
    expect(nextWindowOpening(utc('2026-11-05T09:00:00Z'), w).toISOString()).toBe('2026-11-05T11:00:00.000Z');
    expect(nextWindowOpening(utc('2026-11-06T01:00:00Z'), w).toISOString()).toBe('2026-11-06T11:00:00.000Z'); // 22:00 de quinta
  });

  it('pula o domingo', () => {
    // sábado 21:00 em SP → segunda 08:00
    expect(nextWindowOpening(utc('2026-11-08T00:00:00Z'), w).toISOString()).toBe('2026-11-09T11:00:00.000Z');
  });

  it('não altera o instante recebido', () => {
    const at = utc('2026-11-06T01:00:00.500Z');
    nextWindowOpening(at, w);
    expect(at.toISOString()).toBe('2026-11-06T01:00:00.500Z');
  });
});
