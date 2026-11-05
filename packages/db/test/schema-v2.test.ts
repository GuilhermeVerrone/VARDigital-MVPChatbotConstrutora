import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './db';

// Garantias da V2 que vivem no banco (constraints e triggers da migration 20261105120000).

let t: TestDb;
let devA: string;
let devB: string;

beforeAll(async () => {
  t = await createTestDb();
  const mk = (slug: string) =>
    t.db.development.create({ data: { slug, name: slug, city: 'X', description: 'x', deliveryDate: new Date('2029-01-01') } });
  devA = (await mk('a')).id;
  devB = (await mk('b')).id;
});
afterAll(() => t.drop());

const insertCondition = (version: string, dev: string, from: string, to: string | null) =>
  t.sql(
    `insert into sales_conditions (id, development_id, version, status, valid_from, valid_to, rules, created_by)
     values (gen_random_uuid(), $1, $2, 'ILUSTRATIVO', $3, $4, '{}', 'sql')`,
    [dev, version, from, to],
  );

describe('sales_conditions', () => {
  it('recusa vigências sobrepostas no mesmo empreendimento, mas aceita em outro', async () => {
    await insertCondition('a1', devA, '2026-01-01', '2026-06-30');
    await expect(insertCondition('a2', devA, '2026-06-01', null)).rejects.toThrow(/sales_conditions_no_overlap/);
    await insertCondition('b1', devB, '2026-06-01', null);
  });

  it('recusa vigência invertida', async () => {
    await expect(insertCondition('inv', devA, '2027-02-01', '2027-01-01')).rejects.toThrow(/sales_conditions_valid_range/);
  });

  it('versão é imutável: só valid_to e superseded_by_id mudam; não se apaga', async () => {
    await expect(t.sql(`update sales_conditions set status = 'VALIDADO'`)).rejects.toThrow(/imutável/);
    await expect(t.sql(`update sales_conditions set rules = '{"x":1}'`)).rejects.toThrow(/imutável/);
    await expect(t.sql(`delete from sales_conditions`)).rejects.toThrow(/não podem ser apagadas/);
    await t.sql(`update sales_conditions set valid_to = '2026-12-31' where version = 'b1'`);
  });
});

describe('flow_configs', () => {
  it('rascunho é editável e apagável; publicada só pode virar RETIRED', async () => {
    const draft = await t.db.flowConfig.create({ data: { content: { texts: {} }, createdBy: 'ana' } });
    await t.db.flowConfig.update({ where: { id: draft.id }, data: { content: { texts: { welcome: 'oi' } } } });
    await t.db.flowConfig.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: 'ana' } });

    await expect(t.sql(`update flow_configs set content = '{}' where id = $1`, [draft.id])).rejects.toThrow(/imutável/);
    await expect(t.sql(`delete from flow_configs where id = $1`, [draft.id])).rejects.toThrow(/não pode ser apagada/);
    await t.sql(`update flow_configs set status = 'RETIRED' where id = $1`, [draft.id]);
    await expect(t.sql(`update flow_configs set status = 'DRAFT' where id = $1`, [draft.id])).rejects.toThrow(/imutável/);

    const other = await t.db.flowConfig.create({ data: { content: {}, createdBy: 'ana' } });
    await t.db.flowConfig.delete({ where: { id: other.id } });
  });

  it('versão é sequencial', async () => {
    const a = await t.db.flowConfig.create({ data: { content: {}, createdBy: 'ana' } });
    const b = await t.db.flowConfig.create({ data: { content: {}, createdBy: 'ana' } });
    expect(b.version).toBeGreaterThan(a.version);
  });
});

describe('usuários', () => {
  it('e-mail é único e o corretor tem no máximo um usuário', async () => {
    const broker = await t.db.broker.create({ data: { name: 'C', phone: '5500900000099' } });
    await t.db.user.create({ data: { name: 'U', email: 'u@x.invalid', passwordHash: 'h', role: 'CORRETOR', brokerId: broker.id } });
    await expect(t.db.user.create({ data: { name: 'V', email: 'u@x.invalid', passwordHash: 'h', role: 'ADMIN' } })).rejects.toThrow(/Unique constraint/);
    await expect(
      t.db.user.create({ data: { name: 'W', email: 'w@x.invalid', passwordHash: 'h', role: 'CORRETOR', brokerId: broker.id } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('apagar o usuário apaga as sessões', async () => {
    const u = await t.db.user.create({ data: { name: 'S', email: 's@x.invalid', passwordHash: 'h', role: 'GERENTE' } });
    await t.db.userSession.create({ data: { userId: u.id, tokenHash: 'abc', expiresAt: new Date(Date.now() + 1000) } });
    await t.db.user.delete({ where: { id: u.id } });
    expect(await t.db.userSession.count({ where: { tokenHash: 'abc' } })).toBe(0);
  });
});

describe('campos da V2 em tabelas existentes', () => {
  it('lead vem do WhatsApp por padrão e aceita origem, UTM e modo de pagamento', async () => {
    const legacy = await t.db.lead.create({ data: { phone: '5500911110001' } });
    expect(legacy.source).toBe('WHATSAPP');
    const lead = await t.db.lead.create({
      data: { phone: '5500911110002', developmentId: devA, source: 'SITE_FORM', utm: { source: 'ig' }, paymentMode: 'ENTRADA_PARCELADA', formSubmittedAt: new Date() },
    });
    expect(lead).toMatchObject({ source: 'SITE_FORM', paymentMode: 'ENTRADA_PARCELADA', developmentId: devA });
  });

  it('simulação aceita modo à vista sem parâmetros do banco', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5500911110003' } });
    const sim = await t.db.simulation.create({
      data: { leadId: lead.id, referenceDate: new Date('2026-11-05'), propertyValue: 100000, verdict: 'VIAVEL', input: {}, result: {}, paymentMode: 'A_VISTA' },
    });
    expect(sim.parameterSetId).toBeNull();
    expect(sim.parametersVersion).toBeNull();
  });
});
