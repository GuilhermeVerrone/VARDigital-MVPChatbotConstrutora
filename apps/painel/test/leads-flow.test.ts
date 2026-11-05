import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveTurn } from '@mvp/db';
import { createUser, seedElevareForTest } from './helpers';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { contentToValues, valuesToContent } from '../src/lib/flow-form';
import { ForbiddenError, type PanelUser, type Role } from '../src/lib/permissions';
import { flowService, leadsService, type ServiceCtx } from '../src/lib/services';
import { simulatorStart } from '../src/lib/simulator';
import { PanelNotFoundError, PanelValidationError } from '@mvp/db/panel';

const TODAY = '2026-11-05';
let t: TestDb;
const users = {} as Record<Role, PanelUser>;
let brokerA: string;
let brokerB: string;
const ctx = (role: Role): ServiceCtx => ({ db: t.db, user: users[role], today: TODAY });

beforeAll(async () => {
  t = await createTestDb();
  await seedElevareForTest(t.db, TODAY);
  const brokers = await t.db.broker.findMany({ orderBy: { name: 'asc' } });
  brokerA = brokers[0]!.id;
  brokerB = brokers[1]!.id;
  for (const role of ['ADMIN', 'GERENTE', 'CORRETOR'] as Role[]) {
    const u = await createUser(t.db, { name: role, email: `${role.toLowerCase()}@teste.invalid`, password: 'senha-comprida-1', role, ...(role === 'CORRETOR' ? { brokerId: brokerA } : {}) });
    users[role] = { id: u.id, name: u.name, role, brokerId: u.brokerId };
  }
});
afterAll(() => t.drop());

const firstBot = async (source: 'draft' | 'published') => (await simulatorStart(ctx('GERENTE'), { source, entry: 'WHATSAPP' })).messages.map((m) => m.text).join('\n');
const withText = (key: string, text: string) => ({ ...contentToValues(null), [`text.${key}`]: text });

describe('fluxo: editar, publicar, reverter', () => {
  it('editar e publicar um texto muda a próxima mensagem do bot; reverter volta ao anterior', async () => {
    expect(await firstBot('published')).toMatch(/Qual é o seu nome completo\?/);

    await flowService.saveDraft(ctx('GERENTE'), withText('ASK_NAME', 'Como posso te chamar?'));
    expect(await firstBot('published')).not.toMatch(/Como posso te chamar/); // rascunho não vai ao ar
    await flowService.publish(ctx('GERENTE'), 'primeiro ajuste de tom');
    expect(await firstBot('published')).toMatch(/Como posso te chamar\?/);

    await flowService.saveDraft(ctx('GERENTE'), withText('ASK_NAME', 'Me diz o seu nome?'));
    await flowService.publish(ctx('GERENTE'), 'segundo ajuste');
    expect(await firstBot('published')).toMatch(/Me diz o seu nome\?/);

    await flowService.revert(ctx('GERENTE'), 'ficou pior');
    expect(await firstBot('published')).toMatch(/Como posso te chamar\?/);
    expect(await firstBot('published')).not.toMatch(/Me diz o seu nome/);
    const audit = await t.db.auditLog.findMany({ where: { entity: 'FlowConfig' }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => [a.action, a.actor])).toEqual([['FLOW_PUBLISHED', users.GERENTE.id], ['FLOW_PUBLISHED', users.GERENTE.id], ['FLOW_REVERTED', users.GERENTE.id]]);
  });

  it('texto com variável inválida ou palavra proibida não publica, e nada vai ao ar', async () => {
    const before = await t.db.flowConfig.count({ where: { status: 'PUBLISHED' } });
    const current = await firstBot('published');

    await flowService.saveDraft(ctx('GERENTE'), withText('ASK_EMAIL', 'Qual o seu e-mail, {sobrenome}?'));
    await expect(flowService.publish(ctx('GERENTE'), 'teste')).rejects.toMatchObject({ fields: expect.objectContaining({ 'text.ASK_EMAIL': expect.stringMatching(/\{sobrenome\}/) }) });

    await flowService.saveDraft(ctx('GERENTE'), withText('ASK_EMAIL', 'Seu crédito está aprovado! E-mail?'));
    await expect(flowService.publish(ctx('GERENTE'), 'teste')).rejects.toMatchObject({ fields: expect.objectContaining({ 'text.ASK_EMAIL': expect.stringMatching(/proibida/) }) });

    expect(await t.db.flowConfig.count({ where: { status: 'PUBLISHED' } })).toBe(before);
    expect(await firstBot('published')).toBe(current);

    const { issues } = await flowService.saveDraft(ctx('GERENTE'), withText('ASK_EMAIL', 'Qual o seu e-mail? É opcional.'));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    await flowService.discardDraft(ctx('GERENTE'));
  });

  it('publicar exige motivo e rascunho; etapas opcionais e 1º contato entram no fluxo', async () => {
    await expect(flowService.publish(ctx('GERENTE'), 'x')).rejects.toBeInstanceOf(PanelValidationError);
    const values = { ...contentToValues(null), 'step.EMAIL': 'off', firstContact: 'Oi, {nome}! Responda *sim* para falar do {empreendimento}.' };
    await flowService.saveDraft(ctx('GERENTE'), values);
    await expect(flowService.publish(ctx('GERENTE'), '  ')).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
    const v = await flowService.publish(ctx('GERENTE'), 'sem e-mail e novo 1º contato');
    expect(v.content.optionalSteps).toEqual({ EMAIL: false });
    expect(v.content.firstContact).toMatch(/Responda \*sim\*/);
    const form = await simulatorStart(ctx('GERENTE'), { source: 'published', entry: 'FORM' });
    expect(form.messages.map((m) => m.text).join('\n')).toMatch(/Oi, Maria! Responda \*sim\* para falar do/);
  });

  it('só gestão e admin leem e mexem no fluxo (o corretor não)', async () => {
    await expect(flowService.overview(ctx('CORRETOR'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flowService.saveDraft(ctx('CORRETOR'), contentToValues(null))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flowService.publish(ctx('CORRETOR'), 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flowService.revert(ctx('CORRETOR'), 'x')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(flowService.overview(ctx('ADMIN'))).resolves.toBeDefined();
  });

  it('formulário ↔ conteúdo: só o que difere do padrão é gravado', () => {
    const c = valuesToContent({ ...contentToValues(null), 'text.ASK_NAME': ' Qual o seu nome? \r\n', 'buttons.ASK_PAYMENT_MODE': 'À vista\n\nParcelado ' });
    expect(c.texts).toEqual({ ASK_NAME: 'Qual o seu nome?' });
    expect(c.buttons).toEqual({ ASK_PAYMENT_MODE: ['À vista', 'Parcelado'] });
    expect(valuesToContent(contentToValues(c))).toEqual(c);
    expect(valuesToContent(contentToValues(null))).toEqual({ texts: {}, optionalSteps: {}, buttons: {}, firstContact: null });
  });
});

let seq = 0;
async function lead(brokerId: string | null) {
  const n = ++seq;
  return t.db.lead.create({ data: { name: `Lead ${n}`, phone: `55419888${String(10000 + n).slice(1)}`, channelJid: `55419888${String(10000 + n).slice(1)}@s.whatsapp.net`, brokerId } });
}

describe('leads: o corretor vê só os próprios', () => {
  it('lista, detalhe e todas as ações respeitam o escopo', async () => {
    const mine = await lead(brokerA);
    const other = await lead(brokerB);
    const c = ctx('CORRETOR');
    const ids = (await leadsService.list(c, {})).rows.map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(other.id);
    await expect(leadsService.get(c, other.id)).rejects.toBeInstanceOf(PanelNotFoundError);
    await expect(leadsService.takeHandoff(c, other.id)).rejects.toBeInstanceOf(PanelNotFoundError);
    await expect(leadsService.releaseHandoff(c, other.id)).rejects.toBeInstanceOf(PanelNotFoundError);
    // corretor não atribui nem exclui, nem em lead próprio
    await expect(leadsService.assign(c, mine.id, brokerB)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(leadsService.requestErasure(c, mine.id, 'EXCLUIR')).rejects.toBeInstanceOf(ForbiddenError);
    expect((await leadsService.dashboard(c)).today.total).toBeGreaterThanOrEqual(1);
    // gestão vê os dois
    const all = (await leadsService.list(ctx('GERENTE'), {})).rows.map((r) => r.id);
    expect(all).toEqual(expect.arrayContaining([mine.id, other.id]));
    expect(await t.db.auditLog.count({ where: { actor: users.CORRETOR.id } })).toBe(0);
  });
});

describe('leads: atribuir, handoff e exclusão', () => {
  it('gestão atribui e troca o corretor e a auditoria registra o usuário', async () => {
    const l = await lead(null);
    await leadsService.assign(ctx('GERENTE'), l.id, brokerB);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).brokerId).toBe(brokerB);
    expect(await t.db.auditLog.findFirstOrThrow({ where: { entityId: l.id, action: 'broker_assigned' } })).toMatchObject({ actor: users.GERENTE.id });
  });

  it('assumir e devolver: o bot retoma a pergunta em que o lead estava e pede o envio ao lead', async () => {
    const l = await lead(brokerA);
    const conv = await t.db.conversation.create({ data: { leadId: l.id, channel: 'WHATSAPP', state: 'NAME' } });
    const snap = { state: 'HANDOFF', data: { name: 'Maria' }, returnTo: null, failures: 0, resumeTo: null, lastInboundId: null, adjust: {}, simulationId: null, lgpdFrom: null, handoffFrom: 'INCOME', outbox: [] };
    await saveTurn(t.db, { conversationId: conv.id, leadId: l.id, state: 'HANDOFF', context: snap, history: [], writes: { handoff: true, status: 'HANDOFF' } });

    const c = ctx('CORRETOR');
    expect(await leadsService.takeHandoff(c, l.id)).toEqual({ ok: true });
    await expect(leadsService.takeHandoff(ctx('GERENTE'), l.id)).rejects.toBeInstanceOf(PanelValidationError); // gestão sem corretor vinculado
    const detail = await leadsService.get(c, l.id);
    expect(detail.conversation?.handoff?.takenBy?.name).toBeDefined();

    expect(await leadsService.releaseHandoff(c, l.id)).toEqual({ ok: true });
    const after = await t.db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(after).toMatchObject({ state: 'INCOME', handoff: false, handoffCode: null });
    expect(JSON.stringify((after.context as { outbox: unknown }).outbox)).toMatch(/renda/i);
    expect((await t.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('IN_PROGRESS');
    expect(await t.db.deliveryJob.count({ where: { kind: 'OUTBOX_FLUSH', leadId: l.id, status: 'PENDING' } })).toBe(1);
    expect(await leadsService.releaseHandoff(c, l.id)).toEqual({ ok: false, reason: 'no_handoff' });
  });

  it('pedir a exclusão: confirma, apaga o lead e deixa só o registro mínimo, com quem pediu', async () => {
    const l = await lead(brokerB);
    await expect(leadsService.requestErasure(ctx('GERENTE'), l.id, 'talvez')).rejects.toBeInstanceOf(PanelValidationError);
    expect(await t.db.lead.count({ where: { id: l.id } })).toBe(1);
    const r = await leadsService.requestErasure(ctx('GERENTE'), l.id, ' excluir ');
    expect(r?.leadId).toBe(l.id);
    expect(await t.db.lead.count({ where: { id: l.id } })).toBe(0);
    expect(await t.db.auditLog.findFirstOrThrow({ where: { entityId: l.id, action: 'erased_by_request' } })).toMatchObject({ actor: users.GERENTE.id });
    expect(await t.db.erasureTask.count({ where: { doneAt: null } })).toBeGreaterThanOrEqual(1);
    await expect(leadsService.requestErasure(ctx('GERENTE'), l.id, 'EXCLUIR')).rejects.toBeInstanceOf(PanelNotFoundError);
  });
});
