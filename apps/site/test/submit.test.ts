import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { issueFormToken } from '../src/lib/form-token';
import { createRateLimiter } from '../src/lib/rate-limit';
import { handleSubmission, type SubmitDeps } from '../src/lib/submit';

// Envio do formulário contra Postgres real: o que é gravado e o que o anti-spam barra.

const SECRET = 'segredo-do-teste-1234';
const OPENED = new Date('2026-11-05T14:00:00Z');
const SUBMITTED = new Date('2026-11-05T14:00:20Z'); // 20 s depois

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());
beforeEach(async () => {
  await t.sql('truncate delivery_jobs, audit_logs, consents, conversations, leads, units, developments cascade');
  await t.db.development.create({
    data: { slug: 'lumen-urban', name: 'Lumen Urban', city: 'Curitiba - PR', description: 'x', deliveryDate: new Date('2029-12-15'), published: true },
  });
});

const deps = (over: Partial<SubmitDeps> = {}): SubmitDeps => ({
  db: t.db, formSecret: SECRET, ipLimiter: createRateLimiter({ max: 10, windowMs: 3_600_000 }), phoneLimiter: createRateLimiter({ max: 3, windowMs: 3_600_000 }),
  now: () => SUBMITTED, ...over,
});
const fields = (over: Record<string, string> = {}) => ({
  name: 'Ana Souza', phone: '(41) 98888-7777', email: '', development: 'lumen-urban', typology: 'Studio', consent: 'on', optin: 'on', website: '',
  token: issueFormToken(SECRET, OPENED.getTime()), utm: JSON.stringify({ source: 'google', campaign: 'lancamento' }), ...over,
});
const counts = async () => ({
  leads: await t.db.lead.count(), consents: await t.db.consent.count(), jobs: await t.db.deliveryJob.count({ where: { kind: 'FIRST_CONTACT' } }),
});

describe('envio do formulário', () => {
  it('cria o lead, o consentimento WEB com o texto exato, o código, a UTM e o job FIRST_CONTACT', async () => {
    const r = await handleSubmission(deps(), fields(), '1.1.1.1');
    expect(r).toMatchObject({ status: 'ok', development: 'lumen-urban' });
    const lead = await t.db.lead.findFirstOrThrow({ include: { consents: true, jobs: true } });
    expect(lead).toMatchObject({ phone: '5541988887777', name: 'Ana Souza', source: 'SITE_FORM', utm: { source: 'google', campaign: 'lancamento' } });
    expect(r.status === 'ok' && r.contactCode).toBe(lead.contactCode);
    expect(lead.consents).toHaveLength(2);
    expect(lead.consents.every((c) => c.channel === 'WEB' && (c.textSnapshot ?? '').length > 20)).toBe(true);
    expect(lead.jobs.map((j) => j.kind)).toEqual(['FIRST_CONTACT']);
  });

  it('reenviar o formulário não duplica o lead nem o job', async () => {
    await handleSubmission(deps(), fields(), '1.1.1.1');
    const again = await handleSubmission(deps(), fields({ phone: '41 98888 7777', name: 'Ana S.' }), '1.1.1.1');
    expect(again.status).toBe('ok');
    expect(await counts()).toEqual({ leads: 1, consents: 2, jobs: 1 });
  });

  it('honeypot preenchido: parece sucesso e não grava nada', async () => {
    const r = await handleSubmission(deps(), fields({ website: 'http://spam.example' }), '2.2.2.2');
    expect(r.status).toBe('ignored');
    expect(await counts()).toEqual({ leads: 0, consents: 0, jobs: 0 });
  });

  it('preenchimento rápido demais é barrado', async () => {
    const r = await handleSubmission(deps({ now: () => new Date(OPENED.getTime() + 800) }), fields(), '3.3.3.3');
    expect(r.status).toBe('too-fast');
    expect((await counts()).leads).toBe(0);
  });

  it('token ausente, forjado ou vencido é barrado', async () => {
    for (const token of ['', 'abc', issueFormToken('outra-chave-outra-chave', OPENED.getTime())]) {
      expect((await handleSubmission(deps(), fields({ token }), '4.4.4.4')).status).toBe('expired');
    }
    const late = deps({ now: () => new Date(OPENED.getTime() + 3 * 3_600_000) });
    expect((await handleSubmission(late, fields(), '4.4.4.4')).status).toBe('expired');
    expect((await counts()).leads).toBe(0);
  });

  it('rate limit por IP', async () => {
    const d = deps({ ipLimiter: createRateLimiter({ max: 2, windowMs: 3_600_000 }) });
    const phones = ['(41) 98888-0001', '(41) 98888-0002', '(41) 98888-0003'];
    const out = [];
    for (const phone of phones) out.push((await handleSubmission(d, fields({ phone }), '5.5.5.5')).status);
    expect(out).toEqual(['ok', 'ok', 'rate-limited']);
    expect((await handleSubmission(d, fields({ phone: '(41) 98888-0004' }), '6.6.6.6')).status).toBe('ok');
    expect((await counts()).leads).toBe(3);
  });

  it('rate limit por telefone, mesmo vindo de IPs diferentes', async () => {
    const d = deps();
    const out = [];
    for (let i = 0; i < 4; i++) out.push((await handleSubmission(d, fields(), `7.7.7.${i}`)).status);
    expect(out).toEqual(['ok', 'ok', 'ok', 'rate-limited']);
    expect(await counts()).toEqual({ leads: 1, consents: 2, jobs: 1 });
  });

  it('sem consentimento, sem opt-in ou com dados ruins: erros por campo e nada gravado', async () => {
    const r = await handleSubmission(deps(), fields({ consent: '', optin: '', phone: '123', name: '' }), '8.8.8.8');
    expect(r.status === 'invalid' && Object.keys(r.errors).sort()).toEqual(['consent', 'name', 'optin', 'phone']);
    expect((await counts()).leads).toBe(0);
  });

  it('empreendimento inexistente ou não publicado é recusado', async () => {
    await t.db.development.update({ where: { slug: 'lumen-urban' }, data: { published: false } });
    expect((await handleSubmission(deps(), fields(), '9.9.9.9')).status).toBe('unknown-development');
    expect((await handleSubmission(deps(), fields({ development: 'nao-existe', phone: '(41) 98888-0009' }), '9.9.9.9')).status).toBe('unknown-development');
    expect((await counts()).leads).toBe(0);
  });
});
