import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveTurn, seedElevare } from '../src';
import {
  assignLeadBroker, findLeadHandoff, getPanelDashboard, getPanelLead, listPanelLeads, PanelNotFoundError, PanelValidationError, releaseLeadHandoff, takeLeadHandoff,
} from '../src/panel-entry';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
let brokerA: string;
let brokerB: string;
let inactive: string;
let lumen: string;
let parc: string;
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-05T15:00:00Z');

beforeAll(async () => {
  t = await createTestDb();
  await seedElevare(t.db, { today: '2026-11-05' });
  const brokers = await t.db.broker.findMany({ orderBy: { name: 'asc' } });
  brokerA = brokers[0]!.id;
  brokerB = brokers[1]!.id;
  inactive = (await t.db.broker.create({ data: { name: 'Zé Inativo', phone: '5541999990099', active: false } })).id;
  lumen = (await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' } })).id;
  parc = (await t.db.development.findUniqueOrThrow({ where: { slug: 'parc-verde' } })).id;
});
afterAll(() => t.drop());

let seq = 0;
async function lead(o: Partial<{ name: string; developmentId: string; paymentMode: 'A_VISTA' | 'ENTRADA_A_VISTA' | 'ENTRADA_PARCELADA'; scoreClass: 'HOT' | 'WARM' | 'COLD'; status: 'NEW' | 'SIMULATED' | 'HANDOFF'; brokerId: string | null; source: 'SITE_FORM' | 'WHATSAPP'; confirmed: boolean; simulated: boolean; createdAt: Date }> = {}) {
  const n = ++seq;
  const phone = `55419999${String(10000 + n).slice(1)}`;
  const l = await t.db.lead.create({
    data: {
      name: o.name ?? `Lead ${n}`, phone, contactCode: `ELV-${1000 + n}`, source: o.source ?? 'SITE_FORM', developmentId: o.developmentId ?? lumen,
      ...(o.paymentMode ? { paymentMode: o.paymentMode } : {}), ...(o.scoreClass ? { scoreClass: o.scoreClass } : {}), status: o.status ?? 'NEW',
      brokerId: o.brokerId === undefined ? null : o.brokerId, ...(o.confirmed ? { contactConfirmedAt: NOW } : {}), ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    },
  });
  if (o.simulated) {
    const unit = await t.db.unit.findFirstOrThrow({ where: { developmentId: o.developmentId ?? lumen } });
    await t.db.simulation.create({
      data: { leadId: l.id, unitId: unit.id, paymentMode: o.paymentMode ?? 'ENTRADA_A_VISTA', referenceDate: new Date('2026-11-05'), propertyValue: 500000, verdict: 'VIAVEL', input: {}, result: {} },
    });
  }
  return l;
}

describe('lista de leads', () => {
  it('filtra por empreendimento, modo, parecer, status, corretor e origem, e busca por nome ou código', async () => {
    const a = await lead({ name: 'Ana Lima', paymentMode: 'A_VISTA', scoreClass: 'HOT', status: 'SIMULATED', brokerId: brokerA, source: 'WHATSAPP', developmentId: parc });
    const b = await lead({ name: 'Bruno Reis', paymentMode: 'ENTRADA_PARCELADA', scoreClass: 'COLD', status: 'HANDOFF', brokerId: brokerB });
    const c = await lead({ name: 'Carla Dias' });
    const ids = async (f: Parameters<typeof listPanelLeads>[1]) => (await listPanelLeads(t.db, f)).rows.map((r) => r.id).sort();

    expect(await ids({ developmentId: parc })).toEqual([a.id]);
    expect(await ids({ mode: 'ENTRADA_PARCELADA' })).toEqual([b.id]);
    expect(await ids({ verdict: 'VIAVEL' })).toEqual([a.id]);
    expect(await ids({ verdict: 'INVIAVEL' })).toEqual([b.id]);
    expect(await ids({ status: 'HANDOFF' })).toEqual([b.id]);
    expect(await ids({ brokerId: brokerA })).toEqual([a.id]);
    expect(await ids({ brokerId: 'none' })).toContain(c.id);
    expect(await ids({ brokerId: 'none' })).not.toContain(a.id);
    expect(await ids({ source: 'WHATSAPP' })).toEqual([a.id]);
    expect(await ids({ q: 'bruno' })).toEqual([b.id]);
    expect(await ids({ q: c.contactCode! })).toEqual([c.id]);
    expect(await ids({ q: c.phone!.slice(-6) })).toEqual([c.id]);
    expect(await ids({ status: 'HANDOFF', mode: 'A_VISTA' })).toEqual([]);
  });

  it('o corretor vê só os próprios leads, na lista e no detalhe', async () => {
    const mine = await lead({ brokerId: brokerA });
    const other = await lead({ brokerId: brokerB });
    const free = await lead({ brokerId: null });
    const scope = { brokerId: brokerA };
    const seen = (await listPanelLeads(t.db, {}, scope)).rows.map((r) => r.id);
    expect(seen).toContain(mine.id);
    expect(seen).not.toContain(other.id);
    expect(seen).not.toContain(free.id);
    await expect(getPanelLead(t.db, other.id, scope)).rejects.toBeInstanceOf(PanelNotFoundError);
    await expect(getPanelLead(t.db, free.id, scope)).rejects.toBeInstanceOf(PanelNotFoundError);
    await expect(getPanelLead(t.db, mine.id, scope)).resolves.toBeDefined();
    // usuário sem corretor vinculado não vê nada
    expect((await listPanelLeads(t.db, {}, { brokerId: null })).total).toBe(0);
    await expect(getPanelLead(t.db, 'nao-e-uuid', undefined)).rejects.toBeInstanceOf(PanelNotFoundError);
  });

  it('pagina de 25 em 25', async () => {
    for (let i = 0; i < 27; i++) await lead({ createdAt: new Date(NOW.getTime() - i * 1000) });
    const p1 = await listPanelLeads(t.db, { page: 1 });
    const p2 = await listPanelLeads(t.db, { page: 2 });
    expect(p1.rows).toHaveLength(25);
    expect(p2.rows.length).toBeGreaterThan(0);
    expect(p1.pages).toBeGreaterThanOrEqual(2);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(p1.rows.length + p2.rows.length);
    expect((await listPanelLeads(t.db, { page: 999 })).page).toBe(p1.pages);
  });
});

describe('atribuir corretor', () => {
  it('troca o corretor, audita quem trocou e recusa corretor inativo', async () => {
    const l = await lead({ brokerId: brokerA });
    expect(await assignLeadBroker(t.db, { actor: USER, leadId: l.id, brokerId: brokerB })).toEqual({ changed: true });
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).brokerId).toBe(brokerB);
    const audit = await t.db.auditLog.findFirstOrThrow({ where: { entityId: l.id, action: 'broker_assigned' } });
    expect(audit).toMatchObject({ actor: USER, before: { brokerId: brokerA }, after: { brokerId: brokerB, via: 'panel' } });

    expect(await assignLeadBroker(t.db, { actor: USER, leadId: l.id, brokerId: brokerB })).toEqual({ changed: false });
    await expect(assignLeadBroker(t.db, { actor: USER, leadId: l.id, brokerId: inactive })).rejects.toBeInstanceOf(PanelValidationError);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).brokerId).toBe(brokerB);
    await assignLeadBroker(t.db, { actor: USER, leadId: l.id, brokerId: null });
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).brokerId).toBeNull();
  });

  it('corretor fora do escopo não troca o lead de ninguém', async () => {
    const other = await lead({ brokerId: brokerB });
    await expect(assignLeadBroker(t.db, { actor: USER, leadId: other.id, brokerId: brokerA, scope: { brokerId: brokerA } })).rejects.toBeInstanceOf(PanelNotFoundError);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: other.id } })).brokerId).toBe(brokerB);
  });
});

async function waitingLead(brokerId: string | null = brokerA) {
  const l = await lead({ brokerId, status: 'NEW' });
  const conv = await t.db.conversation.create({ data: { leadId: l.id, channel: 'WHATSAPP', state: 'NAME' } });
  await saveTurn(t.db, { conversationId: conv.id, leadId: l.id, state: 'HANDOFF', context: { data: { phone: l.phone } }, history: [], writes: { handoff: true, status: 'HANDOFF' } });
  return { l, conv };
}
const NEXT = { state: 'NAME', context: { data: {} }, history: [], leadStatus: 'IN_PROGRESS' as const };

describe('assumir e devolver pelo painel', () => {
  it('assume, não deixa outro corretor assumir, devolve com o histórico de status e enfileira o envio', async () => {
    const { l, conv } = await waitingLead(null);
    expect(await takeLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA })).toEqual({ ok: true });
    expect(await takeLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA })).toEqual({ ok: true, alreadyYours: true });
    expect(await takeLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerB })).toEqual({ ok: false, reason: 'taken_by_other' });
    expect(await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ brokerId: brokerA });
    expect(await findLeadHandoff(t.db, l.id)).toMatchObject({ conversationId: conv.id, takenByBrokerId: brokerA });

    expect(await releaseLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerB, next: NEXT, flush: true })).toEqual({ ok: false, reason: 'taken_by_other' });
    expect(await releaseLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA, next: NEXT, flush: true, now: NOW })).toEqual({ ok: true });
    expect(await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).toMatchObject({ state: 'NAME', handoff: false, handoffCode: null, takenByBrokerId: null });
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('IN_PROGRESS');
    expect(await t.db.deliveryJob.count({ where: { kind: 'OUTBOX_FLUSH', leadId: l.id } })).toBe(1);
    expect(await releaseLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA, next: NEXT, flush: true })).toEqual({ ok: false, reason: 'no_handoff' });

    const detail = await getPanelLead(t.db, l.id);
    expect(detail.timeline.filter((e) => e.kind === 'status').map((e) => [e.before, e.after])).toEqual([
      [{ status: 'NEW' }, { status: 'HANDOFF' }],
      [{ status: 'HANDOFF' }, { status: 'IN_PROGRESS' }],
    ]);
    expect(detail.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(['handoff_taken', 'handoff_released']));
  });

  it('só a gestão (force) devolve a conversa que outro corretor assumiu; sem assumir, só com force', async () => {
    const { l } = await waitingLead(brokerA);
    expect(await releaseLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerB, next: NEXT, flush: false })).toEqual({ ok: false, reason: 'not_taken' });
    await takeLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA });
    expect(await releaseLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: null, force: true, next: NEXT, flush: false })).toEqual({ ok: true });
  });

  it('lead fora do escopo não tem o handoff mexido', async () => {
    const { l } = await waitingLead(brokerB);
    await expect(takeLeadHandoff(t.db, { actor: USER, leadId: l.id, brokerId: brokerA, scope: { brokerId: brokerA } })).rejects.toBeInstanceOf(PanelNotFoundError);
  });
});

describe('detalhe e início', () => {
  it('o detalhe traz conversa, simulações, consentimento e a linha do tempo', async () => {
    const l = await lead({ confirmed: true, simulated: true, paymentMode: 'ENTRADA_A_VISTA', scoreClass: 'HOT' });
    await t.db.consent.create({ data: { leadId: l.id, textVersion: 'v1', channel: 'WEB', textSnapshot: 'Aceito', acceptedAt: NOW } });
    await t.db.conversation.create({
      data: { leadId: l.id, channel: 'WHATSAPP', state: 'RESULT', context: { data: { cashNow: 40000 } }, history: [{ role: 'bot', text: 'Oi', at: NOW.toISOString() }, { role: 'lead', text: 'Oi!', at: NOW.toISOString() }] },
    });
    const d = await getPanelLead(t.db, l.id);
    expect(d.consents).toHaveLength(1);
    expect(d.consents[0]).toMatchObject({ textVersion: 'v1', textSnapshot: 'Aceito', revokedAt: null });
    expect(d.simulations).toHaveLength(1);
    expect(d.simulations[0]).toMatchObject({ mode: 'ENTRADA_A_VISTA', verdict: 'VIAVEL' });
    expect(d.conversation).toMatchObject({ state: 'RESULT', collected: { cashNow: 40000 } });
    expect(d.conversation!.history.map((h) => h.role)).toEqual(['bot', 'lead']);
    expect(d.lead.verdict).toBe('VIAVEL');
  });

  it('funil: cada etapa conta quem chegou nela; modo e leads do dia; corretor só vê os dele', async () => {
    await t.sql('truncate leads cascade');
    await lead({ source: 'SITE_FORM' });
    await lead({ source: 'SITE_FORM', confirmed: true });
    await lead({ source: 'SITE_FORM', confirmed: true, simulated: true, paymentMode: 'A_VISTA' });
    await lead({ source: 'SITE_FORM', confirmed: true, simulated: true, paymentMode: 'ENTRADA_A_VISTA', brokerId: brokerA });
    await lead({ source: 'WHATSAPP', simulated: true, paymentMode: 'ENTRADA_A_VISTA', brokerId: brokerA });
    await lead({ source: 'SITE_FORM', createdAt: new Date('2026-11-01T12:00:00Z') });

    const all = await getPanelDashboard(t.db, undefined, NOW);
    expect(all.funnel.map((f) => f.count)).toEqual([5, 3, 2, 1]);
    expect(all.byMode).toEqual([{ mode: 'ENTRADA_A_VISTA', count: 2 }, { mode: 'A_VISTA', count: 1 }]);
    expect(all.today).toEqual({ total: 5, fromSite: 4, fromWhatsapp: 1 });

    const mine = await getPanelDashboard(t.db, { brokerId: brokerA }, NOW);
    expect(mine.funnel.map((f) => f.count)).toEqual([1, 1, 1, 1]);
    expect(mine.today.total).toBe(2);
  });
});
