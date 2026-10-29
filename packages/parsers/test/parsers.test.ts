import { describe, expect, it } from 'vitest';
import {
  INCOME_TYPE_OPTIONS, isSkip, parseCommand, parseDate, parseDurationMonths, parseEmail, parseMoney, parseName,
  parseOption, parsePhone, parseYesNo, refersToSameNumber,
} from '../src';
import * as c from './corpus';

type Row = { category: string; input: string; expected: unknown; got: unknown };

const TODAY = '2026-10-29';

const runners: Record<string, (s: string) => unknown> = {
  money: (s) => parseMoney(s)?.value ?? null,
  yesNo: (s) => parseYesNo(s),
  dates: (s) => parseDate(s, { today: TODAY }),
  names: (s) => parseName(s),
  phones: (s) => parsePhone(s)?.e164 ?? null,
  emails: (s) => parseEmail(s),
  durations: (s) => parseDurationMonths(s),
  options: (s) => parseOption(s, c.listOptions)?.id ?? null,
  incomeTypes: (s) => parseOption(s, INCOME_TYPE_OPTIONS)?.id ?? null,
  commands: (s) => {
    const r = parseCommand(s);
    return r ? (r.target ? `${r.command}:${r.target}` : r.command) : null;
  },
};

const corpora: Record<string, readonly (readonly [string, unknown])[]> = {
  money: c.money, yesNo: c.yesNo, dates: c.dates, names: c.names, phones: c.phones, emails: c.emails,
  durations: c.durations, options: c.options, incomeTypes: c.incomeTypes, commands: c.commands,
};

const rows: Row[] = Object.entries(corpora).flatMap(([category, cases]) =>
  cases.map(([input, expected]) => ({ category, input, expected, got: runners[category]!(input) })),
);

describe('conjunto de teste dos parsers', () => {
  const failures = rows.filter((r) => r.got !== r.expected);
  const wrong = failures.filter((r) => r.got !== null && r.expected !== null);
  const falsePositive = failures.filter((r) => r.got !== null && r.expected === null);

  it('acerta ≥ 95% do total', () => {
    const rate = 1 - failures.length / rows.length;
    if (failures.length) console.log(failures.map((r) => `${r.category}: ${JSON.stringify(r.input)} → ${JSON.stringify(r.got)} (esperado ${JSON.stringify(r.expected)})`).join('\n'));
    console.log(`parsers: ${rows.length - failures.length}/${rows.length} (${(rate * 100).toFixed(1)}%)`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  for (const category of Object.keys(corpora)) {
    it(`${category}: ≥ 95% de acerto`, () => {
      const mine = rows.filter((r) => r.category === category);
      const ok = mine.filter((r) => r.got === r.expected).length;
      expect(ok / mine.length, `${category} ${ok}/${mine.length}`).toBeGreaterThanOrEqual(0.95);
    });
  }

  it('nunca devolve valor errado: só acerta ou se abstém', () => {
    expect(wrong.map((r) => `${r.category}: ${r.input} → ${String(r.got)} (esperado ${String(r.expected)})`)).toEqual([]);
  });

  it('não inventa valor onde deveria se abster', () => {
    expect(falsePositive.map((r) => `${r.category}: ${r.input} → ${String(r.got)}`)).toEqual([]);
  });
});

describe('detalhes', () => {
  it('dinheiro sinaliza valor aproximado', () => {
    expect(parseMoney('uns 5 mil')).toEqual({ value: 5000, approximate: true });
    expect(parseMoney('5 mil e pouco')).toEqual({ value: 5000, approximate: true });
    expect(parseMoney('R$ 5.000')).toEqual({ value: 5000, approximate: false });
  });

  it('telefone: acrescenta o 9 em celular antigo e classifica fixo', () => {
    expect(parsePhone('1381264295')).toMatchObject({ national: '13981264295', ninthDigitAdded: true, kind: 'mobile' });
    expect(parsePhone('(13) 3222-1234')).toMatchObject({ kind: 'landline', ninthDigitAdded: false });
  });

  it('data: ano com 2 dígitos usa a data de hoje como pivô', () => {
    expect(parseDate('05/03/26', { today: TODAY })).toBe('2026-03-05');
    expect(parseDate('05/03/27', { today: TODAY })).toBe('1927-03-05');
    expect(parseDate('30/10/2026', { today: TODAY })).toBeNull();
  });

  it('pular campo opcional', () => {
    for (const s of ['pular', 'não tenho', 'prefiro não informar', 'Depois']) expect(isSkip(s), s).toBe(true);
    for (const s of ['maria@gmail.com', 'sim', '']) expect(isSkip(s), s).toBe(false);
  });

  it('"esse mesmo" reaproveita o número da conversa', () => {
    expect(refersToSameNumber('esse mesmo')).toBe(true);
    expect(refersToSameNumber('é o mesmo daqui')).toBe(true);
    expect(refersToSameNumber('13981264295')).toBe(false);
  });

  it('comando: lgpd tem prioridade sobre os demais', () => {
    expect(parseCommand('quero sair e apagar meus dados')).toEqual({ command: 'lgpd_request' });
  });

  it('opção: conflito entre duas opções se abstém', () => {
    expect(parseOption('clt ou autônomo', INCOME_TYPE_OPTIONS)).toBeNull();
  });
});
