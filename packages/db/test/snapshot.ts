import type { TestDb } from './db';

/** Retrato do estado do banco sem ids nem datas de criação (comparável entre execuções). */
export async function snapshot(t: TestDb) {
  const devs = await t.db.development.findMany({ orderBy: { slug: 'asc' }, include: { units: { orderBy: { code: 'asc' } } } });
  const conditions = await t.db.salesCondition.findMany({ orderBy: { version: 'asc' } });
  return {
    developments: devs.map((d) => ({
      slug: d.slug,
      published: d.published,
      units: d.units.map((u) => [u.code, u.typology, u.price.toNumber(), u.status]),
    })),
    conditions: conditions.map((c) => [c.version, c.status, c.validFrom.toISOString(), c.validTo, c.supersededById, c.rules]),
    brokers: (await t.db.broker.findMany({ orderBy: { phone: 'asc' } })).map((b) => [b.phone, b.name, b.email]),
    users: (await t.db.user.findMany()).map((u) => [u.email, u.role, u.active]),
    parameterSets: (await t.db.parameterSet.findMany()).map((p) => p.version),
    counts: {
      leads: await t.db.lead.count(),
      simulations: await t.db.simulation.count(),
      flows: await t.db.flowConfig.count(),
      audit: await t.db.auditLog.count(),
      sessions: await t.db.userSession.count(),
    },
  };
}
