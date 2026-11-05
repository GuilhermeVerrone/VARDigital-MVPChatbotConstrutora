import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeSalesConditions } from '@mvp/simulation';
import { createFlowDraft, DEFAULT_DEMO_ADMIN_PASSWORD, DemoResetRefusedError, login, publishSalesCondition, resetDemo, seedElevare } from '../src';
import { createTestDb, type TestDb } from './db';
import { snapshot } from './snapshot';

const TODAY = '2026-11-05';
let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.drop());

describe('demo-reset', () => {
  const opts = { today: TODAY, confirm: true };

  it('recusa sem confirmação e em produção, sem apagar nada', async () => {
    await seedElevare(t.db, { today: TODAY });
    await t.db.lead.create({ data: { phone: '5500911110000' } });
    await expect(resetDemo(t.db, { ...opts, confirm: false })).rejects.toBeInstanceOf(DemoResetRefusedError);
    await expect(resetDemo(t.db, { ...opts, appEnv: 'production' })).rejects.toBeInstanceOf(DemoResetRefusedError);
    expect(await t.db.lead.count()).toBe(1);
  });

  it('volta ao estado inicial depois de uso e é idempotente', async () => {
    await seedElevare(t.db, { today: TODAY });
    const initial = await snapshot(t);

    // uso da demo: lead, simulação, nova condição, rascunho de fluxo, sessão, job
    const lumen = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' }, include: { units: true } });
    const lead = await t.db.lead.create({ data: { phone: '5500911110000', source: 'SITE_FORM', developmentId: lumen.id } });
    await t.db.simulation.create({
      data: { leadId: lead.id, unitId: lumen.units[0]!.id, referenceDate: new Date(TODAY), propertyValue: 289000, verdict: 'VIAVEL', input: {}, result: {}, paymentMode: 'A_VISTA' },
    });
    await t.db.unit.update({ where: { id: lumen.units[0]!.id }, data: { status: 'SOLD', price: 1 } });
    const base = illustrativeSalesConditions['lumen-urban'];
    await publishSalesCondition(t.db, {
      developmentId: lumen.id,
      condition: { ...base, status: 'VALIDADO' },
      version: 'lumen-v2',
      validFrom: '2026-12-01',
      actor: 'ana',
      reason: 'validada',
      today: TODAY,
    });
    await createFlowDraft(t.db, { actor: 'ana' });
    await login(t.db, { email: 'admin@elevare.invalid', password: DEFAULT_DEMO_ADMIN_PASSWORD, now: new Date() });
    expect(await snapshot(t)).not.toEqual(initial);

    const first = await resetDemo(t.db, opts);
    expect(first.seed).toMatchObject({ parameters: 'created', developments: 3, salesConditions: 3, adminUser: 'created' });
    expect(await snapshot(t)).toEqual(initial);

    await resetDemo(t.db, opts);
    expect(await snapshot(t)).toEqual(initial);
  });
});
