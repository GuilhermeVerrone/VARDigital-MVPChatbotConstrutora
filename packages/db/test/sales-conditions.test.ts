import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeSalesConditions } from '@mvp/simulation';
import {
  findSalesConditionInForce,
  getSalesConditionInForce,
  IllustrativeSalesConditionRejectedError,
  listSalesConditionAudit,
  listSalesConditions,
  NoSalesConditionInForceError,
  publishSalesCondition,
  SalesConditionTimelineError,
} from '../src';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-11-05';
const base = illustrativeSalesConditions['lumen-urban'];
let t: TestDb;
let devA: string;
let devB: string;

beforeEach(async () => {
  t = await createTestDb();
  const mk = (slug: string) => t.db.development.create({ data: { slug, name: slug, city: 'X', description: 'x', deliveryDate: new Date('2029-12-01') } });
  devA = (await mk('a')).id;
  devB = (await mk('b')).id;
});
afterEach(() => t.drop());

type Over = Partial<Parameters<typeof publishSalesCondition>[1]>;
const publish = (over: Over = {}) =>
  publishSalesCondition(t.db, {
    developmentId: devA,
    condition: base,
    version: 'v1',
    validFrom: '2026-01-01',
    actor: 'seed',
    reason: 'versão inicial',
    today: TODAY,
    allowRetroactive: true,
    ...over,
  });

const tweak = (ratio: number) => ({ ...base, cash: { ...base.cash, discountRatio: ratio } });
const later = (over: Over): Over => ({ version: 'v2', validFrom: '2026-12-01', allowRetroactive: false, ...over });

describe('publicação e vigência', () => {
  it('primeira versão: vira a vigente e grava auditoria com as regras completas', async () => {
    const res = await publish();
    expect(res.mode).toBe('FIRST');
    const found = await findSalesConditionInForce(t.db, devA, TODAY);
    expect(found?.version).toBe('v1');
    expect(found?.condition).toEqual({ ...base, version: 'v1', validFrom: '2026-01-01', validTo: null });
    const audit = await listSalesConditionAudit(t.db, devA);
    expect(audit.map((a) => [a.action, a.actor, a.reason])).toEqual([['SALES_CONDITION_PUBLISHED', 'seed', 'versão inicial']]);
  });

  it('nova versão encerra a anterior na véspera; cada data lê a sua versão', async () => {
    await publish();
    const res = await publish(later({ condition: tweak(0.12), actor: 'ana', reason: 'campanha' }));
    expect(res.mode).toBe('CLOSED_PREVIOUS');
    expect(res.changes).toEqual([{ path: 'cash.discountRatio', before: 0.08, after: 0.12 }]);
    expect(res.previous?.validTo).toBe('2026-11-30');
    expect((await getSalesConditionInForce(t.db, devA, '2026-11-30')).version).toBe('v1');
    expect((await getSalesConditionInForce(t.db, devA, '2026-12-01')).version).toBe('v2');
    const actions = (await listSalesConditionAudit(t.db, devA)).map((a) => a.action);
    expect(actions).toEqual(['SALES_CONDITION_PUBLISHED', 'SALES_CONDITION_PUBLISHED', 'SALES_CONDITION_CLOSED']);
  });

  it('mesma data de início: a anterior fica no histórico como substituída', async () => {
    await publish();
    const res = await publish({ condition: tweak(0.09), version: 'v1b' });
    expect(res.mode).toBe('SUPERSEDED');
    expect((await getSalesConditionInForce(t.db, devA, TODAY)).version).toBe('v1b');
    const all = await listSalesConditions(t.db, devA);
    expect(all.map((c) => [c.version, c.supersededById !== null])).toEqual([
      ['v1', true],
      ['v1b', false],
    ]);
  });

  it('o status entra no diff (ILUSTRATIVO para VALIDADO)', async () => {
    await publish();
    const res = await publish(later({ condition: { ...base, status: 'VALIDADO' } }));
    expect(res.changes).toEqual([{ path: 'status', before: 'ILUSTRATIVO', after: 'VALIDADO' }]);
  });

  it('as linhas do tempo são independentes por empreendimento', async () => {
    await publish();
    await publish({ developmentId: devB, version: 'b1', condition: tweak(0.2) });
    expect((await getSalesConditionInForce(t.db, devA, TODAY)).condition.cash.discountRatio).toBe(0.08);
    expect((await getSalesConditionInForce(t.db, devB, TODAY)).condition.cash.discountRatio).toBe(0.2);
  });

  it('sem condição vigente: null e erro tipado; antes do início também', async () => {
    expect(await findSalesConditionInForce(t.db, devA, TODAY)).toBeNull();
    await expect(getSalesConditionInForce(t.db, devA, TODAY)).rejects.toBeInstanceOf(NoSalesConditionInForceError);
    await publish();
    expect(await findSalesConditionInForce(t.db, devA, '2025-12-31')).toBeNull();
  });

  it('recusa ILUSTRATIVO quando pedido (produção)', async () => {
    await publish();
    await expect(getSalesConditionInForce(t.db, devA, TODAY, { rejectIllustrative: true })).rejects.toBeInstanceOf(IllustrativeSalesConditionRejectedError);
    await publish(later({ condition: { ...base, status: 'VALIDADO' } }));
    expect((await getSalesConditionInForce(t.db, devA, '2026-12-02', { rejectIllustrative: true })).version).toBe('v2');
  });
});

describe('recusas', () => {
  it('retroativa, sem mudança, versão repetida, validTo informado, ator ou motivo vazios', async () => {
    await publish();
    const bad = (over: Over) =>
      expect(publish(later({ condition: tweak(0.1), version: 'v9', ...over }))).rejects.toBeInstanceOf(SalesConditionTimelineError);
    await bad({ validFrom: '2026-10-01' });
    await bad({ condition: base });
    await bad({ version: 'v1' });
    await bad({ condition: { ...tweak(0.1), validTo: '2027-01-01' } });
    await bad({ actor: ' ' });
    await bad({ reason: '' });
  });

  it('publicar antes de uma versão futura já agendada', async () => {
    await publish();
    await publish(later({ condition: tweak(0.1), validFrom: '2027-03-01' }));
    await expect(publish(later({ condition: tweak(0.11), version: 'v3' }))).rejects.toBeInstanceOf(SalesConditionTimelineError);
  });

  it('alteração concorrente (versão esperada diferente)', async () => {
    await publish();
    await expect(publish(later({ condition: tweak(0.1), expectedPreviousVersion: 'outra' }))).rejects.toBeInstanceOf(SalesConditionTimelineError);
  });

  it('condição inválida pelo schema do motor não grava nada', async () => {
    await expect(publish({ condition: { ...base, downPayment: { minRatio: 0.6, maxRatio: 0.3 } } })).rejects.toThrow(/minRatio/);
    expect(await t.db.salesCondition.count()).toBe(0);
    expect(await t.db.auditLog.count()).toBe(0);
  });

  it('empreendimento inexistente', async () => {
    await expect(publish({ developmentId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow();
  });
});

describe('dry-run', () => {
  it('calcula o que mudaria sem gravar', async () => {
    await publish();
    const res = await publish(later({ condition: tweak(0.12), dryRun: true }));
    expect(res.dryRun).toBe(true);
    expect(res.changes).toHaveLength(1);
    expect(await t.db.salesCondition.count()).toBe(1);
    expect((await getSalesConditionInForce(t.db, devA, '2026-12-02')).version).toBe('v1');
    expect(await t.db.auditLog.count()).toBe(1);
  });
});
