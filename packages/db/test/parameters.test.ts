import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeParameters, type SimulationParameters } from '@mvp/simulation';
import {
  changeParameters,
  findParametersInForce,
  getParametersInForce,
  IllustrativeParametersRejectedError,
  InvalidParameterPathError,
  listParameterAudit,
  listParameterSets,
  NoParametersInForceError,
  ParameterTimelineError,
  publishParameters,
} from '../src';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-10-27';
let t: TestDb;

async function publishBase(): Promise<void> {
  await publishParameters(t.db, {
    params: illustrativeParameters,
    version: illustrativeParameters.version,
    validFrom: illustrativeParameters.validFrom,
    actor: 'seed',
    reason: 'versão inicial',
    today: TODAY,
    allowRetroactive: true,
    action: 'PARAMETERS_IMPORTED',
  });
}

const sbpeRate = (p: SimulationParameters) => p.creditLines.find((l) => l.id === 'sbpe')!.annualInterestRate;
const change = (set: string[], validFrom: string, extra: Partial<Parameters<typeof changeParameters>[1]> = {}) =>
  changeParameters(t.db, { set, validFrom, actor: 'ana.financeiro', reason: 'tabela nova do banco', today: TODAY, ...extra });

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.drop());

describe('ida e volta banco ⇄ motor', () => {
  it('o seed ILUSTRATIVO gravado volta idêntico (todas as linhas, faixas e frações)', async () => {
    await publishBase();
    const stored = await getParametersInForce(t.db, TODAY);
    expect(stored.params).toEqual(illustrativeParameters);
  });

  it('valor que não cabe na precisão da coluna é recusado e nada é gravado', async () => {
    await publishBase();
    // annual_interest_rate é DECIMAL(9,8): 9 casas decimais seriam arredondadas em silêncio.
    await expect(change(['lines.sbpe.annualInterestRate=0.123456789'], '2026-11-01')).rejects.toThrow(/precisão/);
    expect(await listParameterSets(t.db)).toHaveLength(1);
  });
});

describe('vigência por data', () => {
  it('sem versão vigente na data → erro explícito (nunca simula sem tabela)', async () => {
    await publishBase();
    await expect(getParametersInForce(t.db, '2025-12-31')).rejects.toBeInstanceOf(NoParametersInForceError);
    expect(await findParametersInForce(t.db, '2025-12-31')).toBeNull();
  });

  it('alteração a partir de F: até F−1 vale a versão anterior; de F em diante, a nova', async () => {
    await publishBase();
    const r = await change(['lines.sbpe.annualInterestRate=0.1199'], '2026-11-01');

    expect(r.mode).toBe('CLOSED_PREVIOUS');
    expect(r.created.version).toBe('v2-2026-11-01');
    expect(r.previous).toMatchObject({ version: illustrativeParameters.version, validFrom: '2026-01-01', validTo: '2026-10-31' });
    expect(r.created).toMatchObject({ validFrom: '2026-11-01', validTo: null });

    const before = await getParametersInForce(t.db, '2026-10-31');
    const after = await getParametersInForce(t.db, '2026-11-01');
    expect(before.version).toBe(illustrativeParameters.version);
    expect(sbpeRate(before.params)).toBe(0.1149);
    expect(after.version).toBe('v2-2026-11-01');
    expect(sbpeRate(after.params)).toBe(0.1199);
    // o resto da tabela foi herdado sem mudança
    expect({ ...after.params, version: '', validFrom: '', validTo: null, creditLines: [] }).toEqual({
      ...illustrativeParameters,
      version: '',
      validFrom: '',
      validTo: null,
      creditLines: [],
    });
    expect(after.params.creditLines.filter((l) => l.id !== 'sbpe')).toEqual(illustrativeParameters.creditLines.filter((l) => l.id !== 'sbpe'));
  });

  it('várias versões encadeadas: cada data lê a sua', async () => {
    await publishBase();
    await change(['lines.sbpe.annualInterestRate=0.1199'], '2026-11-01');
    await change(['lines.sbpe.annualInterestRate=0.125', 'adjustmentToleranceRatio=0.15'], '2027-01-01');

    const at = async (d: string) => {
      const s = await getParametersInForce(t.db, d);
      return [s.version, sbpeRate(s.params), s.params.adjustmentToleranceRatio];
    };
    expect(await at('2026-06-15')).toEqual([illustrativeParameters.version, 0.1149, 0.1]);
    expect(await at('2026-12-31')).toEqual(['v2-2026-11-01', 0.1199, 0.1]);
    expect(await at('2027-01-01')).toEqual(['v3-2027-01-01', 0.125, 0.15]);
    expect(await at('2040-01-01')).toEqual(['v3-2027-01-01', 0.125, 0.15]);

    const sets = await listParameterSets(t.db);
    expect(sets.map((s) => [s.version, s.validFrom, s.validTo])).toEqual([
      [illustrativeParameters.version, '2026-01-01', '2026-10-31'],
      ['v2-2026-11-01', '2026-11-01', '2026-12-31'],
      ['v3-2027-01-01', '2027-01-01', null],
    ]);
  });

  it('segunda alteração na mesma data substitui a versão (histórico preservado)', async () => {
    await publishBase();
    const first = await change(['lines.sbpe.annualInterestRate=0.1199'], '2026-11-01');
    const second = await change(['lines.sbpe.annualInterestRate=0.1189'], '2026-11-01', { version: 'nov26-corrigida' });

    expect(second.mode).toBe('SUPERSEDED');
    expect(second.previous!.version).toBe(first.created.version);
    expect(second.previous!.supersededById).toBe(second.created.id);
    expect((await getParametersInForce(t.db, '2026-11-01')).version).toBe('nov26-corrigida');
    expect(sbpeRate((await getParametersInForce(t.db, '2026-11-01')).params)).toBe(0.1189);
    expect(await listParameterSets(t.db)).toHaveLength(3);
  });

  it('recusa vigência retroativa sem confirmação explícita', async () => {
    await publishBase();
    await expect(change(['lines.sbpe.annualInterestRate=0.1199'], '2026-10-01')).rejects.toThrow(/retroativa/);
    const r = await change(['lines.sbpe.annualInterestRate=0.1199'], '2026-10-01', { allowRetroactive: true });
    expect(r.previous!.validTo).toBe('2026-09-30');
  });

  it('recusa publicar antes de uma versão futura já agendada', async () => {
    await publishBase();
    await change(['lines.sbpe.annualInterestRate=0.125'], '2027-01-01');
    await expect(change(['lines.sbpe.annualInterestRate=0.1199'], '2026-11-01')).rejects.toThrow(/já existe a versão v2-2027-01-01/);
  });

  it('recusa alteração que não muda nada, caminho inexistente e valor inválido (nada gravado)', async () => {
    await publishBase();
    await expect(change(['lines.sbpe.annualInterestRate=0.1149'], '2026-11-01')).rejects.toThrow(/nada mudou/);
    await expect(change(['lines.sbpe.taxa=0.1'], '2026-11-01')).rejects.toBeInstanceOf(InvalidParameterPathError);
    await expect(change(['lines.inexistente.maxLtv=0.5'], '2026-11-01')).rejects.toThrow(/linha de crédito inexistente/);
    await expect(change(['validFrom=2027-01-01'], '2026-11-01')).rejects.toThrow(/controlado pela CLI/);
    await expect(change(['lines.sbpe.maxLtv=1.5'], '2026-11-01')).rejects.toThrow(/maxLtv/);
    await expect(change(['lines.sbpe.maxLtv=abc'], '2026-11-01')).rejects.toThrow(/maxLtv/);
    await expect(change(['status=APROVADO'], '2026-11-01')).rejects.toThrow(/status/);
    await expect(change([], '2026-11-01')).rejects.toThrow(/nenhuma alteração/);
    await expect(change(['lines.sbpe.maxLtv=0.7'], '2026-11-01', { actor: ' ' })).rejects.toThrow(/--by/);
    await expect(change(['lines.sbpe.maxLtv=0.7'], '2026-11-01', { reason: '' })).rejects.toThrow(/--reason/);
    expect(await listParameterSets(t.db)).toHaveLength(1);
    expect(await listParameterAudit(t.db)).toHaveLength(1);
  });

  it('dry-run mostra o que mudaria e não grava nada', async () => {
    await publishBase();
    const r = await change(['lines.sbpe.maxLtv=0.7'], '2026-11-01', { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.changes).toEqual([{ path: 'lines.sbpe.maxLtv', before: 0.8, after: 0.7 }]);
    expect(await listParameterSets(t.db)).toHaveLength(1);
    expect((await getParametersInForce(t.db, '2026-12-01')).validTo).toBeNull();
  });

  it('duas publicações a partir da mesma versão-base na mesma data: uma vence, a outra falha, a linha do tempo fica coerente', async () => {
    await publishBase();
    // As duas partem da mesma versão vigente (lida uma vez, antes de qualquer commit). O lock da tabela serializa
    // as publicações, então a segunda sempre encontra a versão da primeira e é recusada, qualquer que seja a ordem.
    const base = await getParametersInForce(t.db, '2026-11-01');
    const publishWith = (maxLtv: number, version: string) =>
      publishParameters(t.db, {
        params: {
          ...base.params,
          validTo: null,
          creditLines: base.params.creditLines.map((l) => (l.id === 'sbpe' ? { ...l, maxLtv } : l)),
        },
        version,
        validFrom: '2026-11-01',
        actor: 'ana.financeiro',
        reason: 'tabela nova do banco',
        today: TODAY,
        action: 'PARAMETERS_CHANGED',
        expectedPreviousVersion: base.version,
      });
    const results = await Promise.allSettled([publishWith(0.7, 'a'), publishWith(0.75, 'b')]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(ParameterTimelineError);
    expect(failed[0]!.reason.message).toMatch(/vigente mudou/);
    const sets = await listParameterSets(t.db);
    expect(sets.filter((s) => !s.supersededById).map((s) => [s.validFrom, s.validTo])).toEqual([
      ['2026-01-01', '2026-10-31'],
      ['2026-11-01', null],
    ]);
  });

  it('alterações concorrentes pelo changeParameters: nunca corrompem a linha do tempo, vençam uma ou as duas em sequência', async () => {
    await publishBase();
    // changeParameters lê a base antes do lock. Se as duas leituras acontecem antes do primeiro commit, a segunda é
    // recusada; se a primeira já terminou, a segunda a substitui (também válido). O invariante vale nos dois casos.
    const results = await Promise.allSettled([
      change(['lines.sbpe.maxLtv=0.7'], '2026-11-01', { version: 'a' }),
      change(['lines.sbpe.maxLtv=0.75'], '2026-11-01', { version: 'b' }),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ParameterTimelineError);
    }
    const sets = await listParameterSets(t.db);
    expect(sets.filter((s) => !s.supersededById).map((s) => [s.validFrom, s.validTo])).toEqual([
      ['2026-01-01', '2026-10-31'],
      ['2026-11-01', null],
    ]);
  });
});

describe('auditoria (RF-52)', () => {
  it('cada alteração grava quem, quando, motivo, antes e depois', async () => {
    await publishBase();
    await change(['lines.sbpe.annualInterestRate=0.1199', 'lines.sbpe.adminFeeMonthly=30'], '2026-11-01');

    const audit = await listParameterAudit(t.db);
    expect(audit.map((a) => a.action)).toEqual(['PARAMETERS_IMPORTED', 'PARAMETERS_CHANGED', 'PARAMETERS_CLOSED']);

    const imported = audit[0]!;
    expect(imported.before).toBeNull();
    expect(imported.after).toMatchObject({ version: illustrativeParameters.version, status: 'ILUSTRATIVO', params: illustrativeParameters });

    const changed = audit[1]!;
    expect(changed).toMatchObject({ actor: 'ana.financeiro', reason: 'tabela nova do banco', entity: 'ParameterSet' });
    expect(changed.before).toEqual({
      version: illustrativeParameters.version,
      values: { 'lines.sbpe.adminFeeMonthly': 25, 'lines.sbpe.annualInterestRate': 0.1149 },
    });
    expect(changed.after).toEqual({
      version: 'v2-2026-11-01',
      status: 'ILUSTRATIVO',
      validFrom: '2026-11-01',
      validTo: null,
      values: { 'lines.sbpe.adminFeeMonthly': 30, 'lines.sbpe.annualInterestRate': 0.1199 },
    });
    expect(changed.at).toBeInstanceOf(Date);

    expect(audit[2]!.before).toEqual({ version: illustrativeParameters.version, validTo: null });
    expect(audit[2]!.after).toEqual({ version: illustrativeParameters.version, validTo: '2026-10-31' });
  });

  it('validar a tabela é uma alteração auditada como outra qualquer', async () => {
    await publishBase();
    await change(['status=VALIDADO'], '2026-11-01');
    const now = await getParametersInForce(t.db, '2026-11-01', { rejectIllustrative: true });
    expect(now.params.status).toBe('VALIDADO');
    expect((await listParameterAudit(t.db))[1]!.after).toMatchObject({ values: { status: 'VALIDADO' } });
  });
});

describe('ILUSTRATIVO em produção', () => {
  it('rejectIllustrative recusa versão não validada pelo financeiro', async () => {
    await publishBase();
    await expect(getParametersInForce(t.db, TODAY, { rejectIllustrative: true })).rejects.toBeInstanceOf(IllustrativeParametersRejectedError);
    expect((await getParametersInForce(t.db, TODAY)).params.status).toBe('ILUSTRATIVO');
  });
});
