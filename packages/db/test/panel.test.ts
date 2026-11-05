import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { illustrativeSalesConditions, type SalesCondition } from '@mvp/simulation';
import { runAndRecordPaymentSimulation, seedElevare, listSalesConditions } from '../src';
import {
  createDevelopment,
  getFinancingView,
  listAdminBrokers,
  listAdminDevelopments,
  listAuditLogs,
  PanelValidationError,
  previewPayment,
  publishFinancingLine,
  publishSalesCondition,
  saveBroker,
  saveUnit,
  SAMPLE_PROFILES,
  setDevelopmentPublished,
  updateDevelopment,
} from '../src/panel-entry';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-11-05';
const TOMORROW = '2026-11-06';
let t: TestDb;
let admin: string;
let lumenId: string;
let unitId: string;

beforeAll(async () => {
  t = await createTestDb();
  await seedElevare(t.db, { today: TODAY });
  admin = (await t.db.user.findFirstOrThrow()).id;
  const lumen = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' }, include: { units: { where: { code: 'LU-0304' } } } });
  lumenId = lumen.id;
  unitId = lumen.units[0]!.id;
});
afterAll(() => t.drop());

const audit = (entity: string, entityId: string) => t.db.auditLog.findMany({ where: { entity, entityId }, orderBy: { id: 'asc' } });

describe('empreendimentos e unidades', () => {
  it('cria, edita e publica no site, com auditoria do usuário e só dos campos que mudaram', async () => {
    const d = await createDevelopment(t.db, {
      actor: admin,
      data: { slug: 'novo-teste', name: 'Novo', city: 'Curitiba - PR', address: '', description: 'Texto', deliveryDate: '2029-06-30', heroImage: '', highlights: ['Piscina'], active: true },
    });
    expect(d.published).toBe(false);
    await updateDevelopment(t.db, {
      actor: admin, id: d.id,
      data: { name: 'Novo', city: 'Curitiba - PR', address: '', description: 'Outro texto', deliveryDate: '2029-06-30', heroImage: '', highlights: ['Piscina'], active: true },
    });
    await setDevelopmentPublished(t.db, { actor: admin, id: d.id, published: true });
    const rows = await audit('Development', d.id);
    expect(rows.map((r) => r.action)).toEqual(['DEVELOPMENT_CREATED', 'DEVELOPMENT_UPDATED', 'DEVELOPMENT_PUBLISHED']);
    expect(rows.every((r) => r.actor === admin)).toBe(true);
    expect(rows[1]).toMatchObject({ before: { description: 'Texto' }, after: { description: 'Outro texto' } });
    expect((await listAdminDevelopments(t.db)).find((x) => x.id === d.id)?.published).toBe(true);
  });

  it('recusa identificador repetido, data inválida e publicar empreendimento inativo', async () => {
    const base = { name: 'X', city: 'Y', address: '', description: 'Z', deliveryDate: '2029-06-30', heroImage: '', highlights: [], active: true };
    await expect(createDevelopment(t.db, { actor: admin, data: { ...base, slug: 'lumen-urban' } })).rejects.toMatchObject({ fields: { slug: expect.any(String) } });
    await expect(createDevelopment(t.db, { actor: admin, data: { ...base, slug: 'outro', deliveryDate: '2029-02-31' } })).rejects.toBeInstanceOf(PanelValidationError);
    const d = await createDevelopment(t.db, { actor: admin, data: { ...base, slug: 'inativo', active: false } });
    await expect(setDevelopmentPublished(t.db, { actor: admin, id: d.id, published: true })).rejects.toBeInstanceOf(PanelValidationError);
  });

  it('unidade: cria, muda preço e status com auditoria; código repetido e preço inválido são recusados', async () => {
    const u = await saveUnit(t.db, { actor: admin, developmentId: lumenId, data: { code: 'LU-TESTE', typology: 'Studio', areaM2: 30.5, price: 250000, status: 'AVAILABLE' } });
    await saveUnit(t.db, { actor: admin, developmentId: lumenId, id: u.id, data: { code: 'LU-TESTE', typology: 'Studio', areaM2: 30.5, price: 260000, status: 'RESERVED' } });
    const rows = await audit('Unit', u.id);
    expect(rows.map((r) => r.action)).toEqual(['UNIT_CREATED', 'UNIT_UPDATED']);
    expect(rows[1]).toMatchObject({ actor: admin, before: { price: 250000, status: 'AVAILABLE' }, after: { price: 260000, status: 'RESERVED' } });
    await expect(saveUnit(t.db, { actor: admin, developmentId: lumenId, data: { code: 'LU-TESTE', typology: 'S', areaM2: 1, price: 1, status: 'AVAILABLE' } })).rejects.toMatchObject({ fields: { code: expect.any(String) } });
    await expect(saveUnit(t.db, { actor: admin, developmentId: lumenId, id: u.id, data: { code: 'LU-TESTE', typology: 'S', areaM2: 1, price: -5, status: 'SOLD' } })).rejects.toMatchObject({ fields: { price: expect.any(String) } });
  });
});

describe('corretores', () => {
  it('cria, edita, desativa e audita; normaliza o telefone e recusa duplicado', async () => {
    const b = await saveBroker(t.db, { actor: admin, data: { name: 'Carlos', phone: '+55 (41) 99999-0001', email: '', team: '', active: true } });
    expect(b.phone).toBe('5541999990001');
    await saveBroker(t.db, { actor: admin, id: b.id, data: { name: 'Carlos', phone: '5541999990001', email: '', team: '', active: false } });
    const rows = await audit('Broker', b.id);
    expect(rows.map((r) => r.action)).toEqual(['BROKER_CREATED', 'BROKER_DEACTIVATED']);
    await expect(saveBroker(t.db, { actor: admin, data: { name: 'Outro', phone: '5541999990001', email: '', team: '', active: true } })).rejects.toMatchObject({ fields: { phone: expect.any(String) } });
    await expect(saveBroker(t.db, { actor: admin, data: { name: 'Sem DDD', phone: '999990001', email: 'x', team: '', active: true } })).rejects.toBeInstanceOf(PanelValidationError);
    expect((await listAdminBrokers(t.db)).find((x) => x.id === b.id)?.active).toBe(false);
  });
});

describe('condições comerciais: o bot lê a nova versão sem deploy', () => {
  it('publicar no painel muda a próxima simulação e aparece na auditoria com o usuário', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5500922220000', name: 'Ana', birthDate: new Date('1990-03-05'), source: 'SITE_FORM', developmentId: lumenId, status: 'IN_PROGRESS' } });
    await t.db.financialProfile.create({
      data: { leadId: lead.id, grossMonthlyIncome: 9000, incomeType: 'CLT', monthlyDebts: 500, availableDownPayment: 30000, cashNow: 30000, acceptsBalloons: true, ownsResidentialProperty: false, firstFinancing: true },
    });
    const before = await runAndRecordPaymentSimulation(t.db, { leadId: lead.id, unitId, mode: 'A_VISTA', referenceDate: TOMORROW });
    const base = illustrativeSalesConditions['lumen-urban'];
    const draft: SalesCondition = { ...base, cash: { enabled: true, discountRatio: 0.2 } };
    const published = await publishSalesCondition(t.db, { developmentId: lumenId, condition: draft, version: 'lumen-painel-1', validFrom: TOMORROW, actor: admin, reason: 'desconto maior', today: TODAY });
    const after = await runAndRecordPaymentSimulation(t.db, { leadId: lead.id, unitId, mode: 'A_VISTA', referenceDate: TOMORROW });
    expect(after.salesConditionVersion).toBe('lumen-painel-1');
    expect(before.salesConditionVersion).not.toBe('lumen-painel-1');
    expect(after.result.cash?.amountToPay).toBe(289000 * 0.8);
    expect(after.result.cash?.amountToPay).not.toBe(before.result.cash?.amountToPay);

    const { rows } = await listAuditLogs(t.db, { entity: 'SalesCondition', actor: admin });
    expect(rows.find((r) => r.entityId === published.created.id)).toMatchObject({ action: 'SALES_CONDITION_PUBLISHED', actorName: expect.any(String), reason: 'desconto maior' });
    expect((await listSalesConditions(t.db, lumenId)).map((c) => c.version)).toContain('lumen-painel-1');
  });
});

describe('prévia do painel = cálculo do bot', () => {
  it.each(['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA'] as const)('modo %s: mesmo resultado que a simulação gravada para o mesmo perfil', async (mode) => {
    for (const profile of SAMPLE_PROFILES) {
      const preview = await previewPayment(t.db, { unitId, mode, profileId: profile.id, referenceDate: TOMORROW });
      const lead = await t.db.lead.create({ data: { phone: `550093${Math.floor(Math.random() * 1e7)}`, name: 'Real', birthDate: new Date(profile.birthDate), source: 'WHATSAPP', developmentId: lumenId, status: 'IN_PROGRESS' } });
      await t.db.financialProfile.create({
        data: {
          leadId: lead.id, grossMonthlyIncome: profile.grossMonthlyIncome, incomeType: profile.incomeType, monthlyDebts: profile.monthlyDebts,
          availableDownPayment: profile.cashNow, cashNow: profile.cashNow, acceptsBalloons: profile.acceptsBalloons, ownsResidentialProperty: false, firstFinancing: true,
        },
      });
      const real = await runAndRecordPaymentSimulation(t.db, { leadId: lead.id, unitId, mode, referenceDate: TOMORROW });
      expect(preview.result).toEqual(real.result);
      expect(preview.conditionVersion).toBe(real.salesConditionVersion);
      expect(preview.parametersVersion).toBe(real.parametersVersion);
    }
  });

  it('com rascunho, calcula pelo rascunho sem gravar nada', async () => {
    const base = illustrativeSalesConditions['lumen-urban'];
    const sims = await t.db.simulation.count();
    const versions = await t.db.salesCondition.count();
    const r = await previewPayment(t.db, { unitId, mode: 'A_VISTA', profileId: 'renda-media', referenceDate: TOMORROW, draftCondition: { ...base, cash: { enabled: true, discountRatio: 0.5 } } });
    expect(r.conditionVersion).toBeNull();
    expect(r.result.cash?.amountToPay).toBe(289000 * 0.5);
    expect(await t.db.simulation.count()).toBe(sims);
    expect(await t.db.salesCondition.count()).toBe(versions);
  });
});

describe('financiamento simulado', () => {
  it('cria uma nova ParameterSet com a linha alterada e audita', async () => {
    const before = await getFinancingView(t.db, TOMORROW);
    const line = before.lines.find((l) => l.id === 'sbpe')!;
    const res = await publishFinancingLine(t.db, {
      actor: admin, today: TODAY,
      data: { lineId: 'sbpe', annualInterestRate: line.annualInterestRate + 0.01, termMin: line.termMonths.min, termMax: 300, systems: ['PRICE'], defaultSystem: 'PRICE', maxIncomeCommitment: 0.3, validFrom: TOMORROW, reason: 'taxa do banco subiu' },
    });
    expect(res.created.version).not.toBe(before.version);
    const after = await getFinancingView(t.db, TOMORROW);
    expect(after.lines.find((l) => l.id === 'sbpe')).toMatchObject({ termMonths: { max: 300 }, systems: ['PRICE'], maxIncomeCommitment: 0.3 });
    expect(after.defaultSystem).toBe('PRICE');
    const rows = await audit('ParameterSet', res.created.id);
    expect(rows[0]).toMatchObject({ actor: admin, action: 'PARAMETERS_CHANGED', reason: 'taxa do banco subiu' });
  });

  it('recusa prazo invertido, sistema padrão fora da lista e linha inexistente', async () => {
    const ok = { lineId: 'sbpe', annualInterestRate: 0.1, termMin: 60, termMax: 360, systems: ['SAC'], defaultSystem: 'SAC', maxIncomeCommitment: 0.3, validFrom: '2026-11-07', reason: 'teste' };
    await expect(publishFinancingLine(t.db, { actor: admin, today: TODAY, data: { ...ok, termMin: 400 } })).rejects.toBeInstanceOf(PanelValidationError);
    await expect(publishFinancingLine(t.db, { actor: admin, today: TODAY, data: { ...ok, defaultSystem: 'PRICE' } })).rejects.toBeInstanceOf(PanelValidationError);
    await expect(publishFinancingLine(t.db, { actor: admin, today: TODAY, data: { ...ok, lineId: 'nao-existe' } })).rejects.toThrow();
  });
});

describe('auditoria', () => {
  it('filtra por entidade, ação, usuário e data, e pagina', async () => {
    const all = await listAuditLogs(t.db, { take: 5 });
    expect(all.rows).toHaveLength(5);
    expect(all.next).not.toBeNull();
    const page2 = await listAuditLogs(t.db, { take: 5, before: all.next! });
    expect(page2.rows[0]!.id).toBeLessThan(all.rows[4]!.id);
    const units = await listAuditLogs(t.db, { entity: 'Unit', action: 'UNIT_CREATED', actor: admin });
    expect(units.rows.length).toBeGreaterThan(0);
    expect(units.rows.every((r) => r.entity === 'Unit' && r.actorName !== admin)).toBe(true);
    expect((await listAuditLogs(t.db, { from: '2000-01-01', to: '2000-01-02' })).rows).toHaveLength(0);
  });
});
