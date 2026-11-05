import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPublishedDevelopment, listPublishedDevelopments, submitSiteLead, UnknownDevelopmentError, type SiteLeadInput } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate audit_logs, delivery_jobs, consents, conversations, leads, units, developments cascade');
});

async function seedDev(over: { slug?: string; published?: boolean } = {}) {
  const d = await t.db.development.create({
    data: {
      slug: over.slug ?? 'lumen-urban', name: 'Lumen Urban', city: 'Curitiba - PR', description: 'x', deliveryDate: new Date('2029-12-15'),
      published: over.published ?? true, highlights: ['Sacada'], gallery: [{ url: '/a.png', alt: 'Fachada' }],
    },
  });
  await t.db.unit.createMany({
    data: [
      { developmentId: d.id, code: 'A1', typology: 'Studio', areaM2: 28, price: 289000 },
      { developmentId: d.id, code: 'A2', typology: 'Studio', areaM2: 30, price: 318000 },
      { developmentId: d.id, code: 'B1', typology: '2 dormitórios', areaM2: 52, price: 529000 },
      { developmentId: d.id, code: 'S1', typology: 'Studio', areaM2: 27, price: 100000, status: 'SOLD' },
    ],
  });
  return d;
}

const input = (over: Partial<SiteLeadInput> = {}): SiteLeadInput => ({
  name: 'Ana Souza', phone: '5511912345678', email: null, developmentSlug: 'lumen-urban', typology: 'Studio', utm: { source: 'google' },
  consentText: 'Aceito a política de privacidade', optInText: 'Aceito contato por WhatsApp', ...over,
});

describe('submitSiteLead', () => {
  it('cria lead, dois consentimentos WEB, código e um job FIRST_CONTACT', async () => {
    await seedDev();
    const r = await submitSiteLead(t.db, input());
    expect(r).toMatchObject({ created: true, firstContactQueued: true });
    expect(r.contactCode).toMatch(/^ELV-\d{4}$/);
    const lead = await t.db.lead.findUniqueOrThrow({ where: { id: r.leadId }, include: { consents: true, jobs: true } });
    expect(lead).toMatchObject({ source: 'SITE_FORM', status: 'NEW', phone: '5511912345678', utm: { source: 'google' } });
    expect(lead.consents.map((c) => c.textVersion).sort()).toEqual(['web-1', 'web-optin-1']);
    expect(lead.consents.every((c) => c.channel === 'WEB' && c.textSnapshot)).toBe(true);
    expect(lead.jobs).toHaveLength(1);
    expect(lead.jobs[0]).toMatchObject({ kind: 'FIRST_CONTACT', status: 'PENDING', payload: { developmentSlug: 'lumen-urban', typology: 'Studio' } });
    // nenhum dado pessoal no payload do job
    expect(JSON.stringify(lead.jobs[0]!.payload)).not.toMatch(/Ana|5511|@/);
  });

  it('reenviar o formulário não duplica lead, consentimento nem job', async () => {
    await seedDev();
    const a = await submitSiteLead(t.db, input());
    const b = await submitSiteLead(t.db, input({ email: 'ana@exemplo.com', utm: { source: 'outro' } }));
    expect(b).toMatchObject({ leadId: a.leadId, created: false, firstContactQueued: false, contactCode: a.contactCode });
    expect(await t.db.lead.count()).toBe(1);
    expect(await t.db.consent.count()).toBe(2);
    expect(await t.db.deliveryJob.count()).toBe(1);
    const lead = await t.db.lead.findUniqueOrThrow({ where: { id: a.leadId } });
    expect(lead).toMatchObject({ email: 'ana@exemplo.com', utm: { source: 'google' } });
  });

  it('não muda a origem de quem já conversou no WhatsApp', async () => {
    const d = await seedDev();
    const lead = await t.db.lead.create({ data: { name: 'Ana', phone: '5511912345678', source: 'WHATSAPP', status: 'IN_PROGRESS' } });
    await t.db.conversation.create({ data: { leadId: lead.id, channel: 'WHATSAPP', state: 'ASK_NAME' } });
    const r = await submitSiteLead(t.db, input());
    expect(r.leadId).toBe(lead.id);
    expect(await t.db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ source: 'WHATSAPP', status: 'IN_PROGRESS', developmentId: d.id });
  });

  it('recusa empreendimento inexistente ou não publicado', async () => {
    await seedDev({ published: false });
    await expect(submitSiteLead(t.db, input())).rejects.toBeInstanceOf(UnknownDevelopmentError);
    await expect(submitSiteLead(t.db, input({ developmentSlug: 'nao-existe' }))).rejects.toBeInstanceOf(UnknownDevelopmentError);
    expect(await t.db.lead.count()).toBe(0);
  });
});

describe('catálogo público', () => {
  it('lista só os publicados, com "a partir de" das unidades disponíveis', async () => {
    await seedDev();
    await seedDev({ slug: 'oculto', published: false });
    const list = await listPublishedDevelopments(t.db);
    expect(list.map((d) => d.slug)).toEqual(['lumen-urban']);
    const d = list[0]!;
    expect(d.fromPrice).toBe(289000);
    expect(d.typologies).toEqual([
      { typology: 'Studio', minArea: 28, maxArea: 30, fromPrice: 289000, available: 2 },
      { typology: '2 dormitórios', minArea: 52, maxArea: 52, fromPrice: 529000, available: 1 },
    ]);
    expect(d.gallery).toEqual([{ url: '/a.png', alt: 'Fachada' }]);
  });

  it('acha por slug e devolve null para não publicado', async () => {
    await seedDev();
    await seedDev({ slug: 'oculto', published: false });
    expect((await getPublishedDevelopment(t.db, 'lumen-urban'))?.name).toBe('Lumen Urban');
    expect(await getPublishedDevelopment(t.db, 'oculto')).toBeNull();
  });
});
