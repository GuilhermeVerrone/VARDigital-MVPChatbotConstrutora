import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { illustrativeSalesConditions } from '@mvp/simulation';
import {
  findSalesConditionInForce,
  listSalesConditions,
  login,
  publishSalesCondition,
  seedElevare,
  DEFAULT_DEMO_ADMIN_PASSWORD,
} from '../src';
import { createTestDb, type TestDb } from './db';
import { snapshot } from './snapshot';

const TODAY = '2026-11-05';
let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.drop());

describe('seedElevare', () => {
  it('cria os 3 empreendimentos Elevare publicados, com unidades, condição vigente, corretores e admin', async () => {
    const summary = await seedElevare(t.db, { today: TODAY });
    expect(summary).toMatchObject({ parameters: 'created', developments: 3, units: 14, salesConditions: 3, brokers: 3, adminUser: 'created' });

    const devs = await t.db.development.findMany({ orderBy: { slug: 'asc' }, include: { units: true } });
    expect(devs.map((d) => d.slug)).toEqual(['altomare', 'lumen-urban', 'parc-verde']);
    for (const d of devs) {
      expect(d).toMatchObject({ published: true, dataStatus: 'ILUSTRATIVO', active: true });
      expect(d.heroImage).toMatch(new RegExp(`^/empreendimentos/${d.slug}/`));
      expect(d.units.length).toBeGreaterThan(0);
      expect(d.units.every((u) => u.status === 'AVAILABLE')).toBe(true);
      const inForce = await findSalesConditionInForce(t.db, d.id, TODAY);
      expect(inForce?.condition).toEqual({ ...illustrativeSalesConditions[d.slug as keyof typeof illustrativeSalesConditions] });
      expect(inForce?.condition.status).toBe('ILUSTRATIVO');
    }
    // contatos fictícios, inalcançáveis
    const brokers = await t.db.broker.findMany();
    expect(brokers.every((b) => b.phone.startsWith('5500') && b.email!.endsWith('.invalid'))).toBe(true);
    const admin = await t.db.user.findFirstOrThrow();
    expect(admin).toMatchObject({ role: 'ADMIN', email: 'admin@elevare.invalid', active: true });
    expect((await login(t.db, { email: admin.email, password: DEFAULT_DEMO_ADMIN_PASSWORD, now: new Date() })).ok).toBe(true);
  });

  it('rodar de novo não duplica nada nem mexe no que já foi publicado ou alterado', async () => {
    await seedElevare(t.db, { today: TODAY });
    const lumen = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' } });
    const base = illustrativeSalesConditions['lumen-urban'];
    await publishSalesCondition(t.db, {
      developmentId: lumen.id,
      condition: { ...base, cash: { ...base.cash, discountRatio: 0.12 } },
      version: 'lumen-v2',
      validFrom: '2026-12-01',
      actor: 'ana',
      reason: 'campanha',
      today: TODAY,
    });
    const before = await snapshot(t);

    const again = await seedElevare(t.db, { today: TODAY });
    expect(again).toMatchObject({ parameters: 'kept', salesConditions: 0, adminUser: 'kept' });
    expect(await snapshot(t)).toEqual(before);
    expect((await listSalesConditions(t.db, lumen.id)).map((c) => c.version)).toEqual([base.version, 'lumen-v2']);
  });

  it('usa a senha informada para o admin de demo', async () => {
    await seedElevare(t.db, { today: TODAY, adminPassword: 'outra-senha-forte-1' });
    const ok = await login(t.db, { email: 'admin@elevare.invalid', password: 'outra-senha-forte-1', now: new Date() });
    expect(ok.ok).toBe(true);
  });
});
