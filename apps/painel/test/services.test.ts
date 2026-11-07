import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, listAuditLogs, seedElevareForTest } from './helpers';
import { runAndRecordPaymentSimulation } from '@mvp/db';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { conditionToValues } from '../src/lib/condition-form';
import { ForbiddenError, type PanelUser, type Role } from '../src/lib/permissions';
import { brokersService, usersService, checkConditionDraft, developmentsService, financingService, previewConditionService, publishConditionDraft, type ServiceCtx } from '../src/lib/services';
import { signIn, signOut, userForToken } from '../src/lib/auth';

const TODAY = '2026-11-05';
const NEXT = '2026-11-06';
let t: TestDb;
const users = {} as Record<Role, PanelUser>;
let lumenId: string;
let unitId: string;
let devValues: Record<string, string>;

const ctx = (role: Role): ServiceCtx => ({ db: t.db, user: users[role], today: TODAY });

beforeAll(async () => {
  t = await createTestDb();
  await seedElevareForTest(t.db, TODAY);
  for (const role of ['ADMIN', 'GERENTE', 'CORRETOR'] as Role[]) {
    const broker = role === 'CORRETOR' ? await t.db.broker.findFirstOrThrow() : null;
    const u = await createUser(t.db, { name: role, email: `${role.toLowerCase()}@teste.invalid`, password: 'senha-comprida-1', role, ...(broker ? { brokerId: broker.id } : {}) });
    users[role] = { id: u.id, name: u.name, role, brokerId: u.brokerId };
  }
  const lumen = await t.db.development.findUniqueOrThrow({ where: { slug: 'lumen-urban' }, include: { units: { where: { code: 'LU-0304' } } } });
  lumenId = lumen.id;
  unitId = lumen.units[0]!.id;
  const current = await t.db.salesCondition.findFirstOrThrow({ where: { developmentId: lumenId } });
  const { parseSalesCondition } = await import('@mvp/simulation');
  devValues = conditionToValues(parseSalesCondition({ ...(current.rules as object), version: current.version, status: current.status, validFrom: '2026-01-01', validTo: null }));
});
afterAll(() => t.drop());

describe('papéis nos serviços (a rota protegida não depende do menu)', () => {
  it('corretor não lê nem altera nada do painel', async () => {
    const c = ctx('CORRETOR');
    await expect(developmentsService.list(c)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(developmentsService.setPublished(c, lumenId, false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(developmentsService.saveUnit(c, lumenId, undefined, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(brokersService.list(c)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(brokersService.save(c, undefined, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(checkConditionDraft(c, { developmentId: lumenId, values: devValues, validFrom: NEXT })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(publishConditionDraft(c, { developmentId: lumenId, values: devValues, validFrom: NEXT, reason: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewConditionService(c, { developmentId: lumenId, unitId, profileId: 'renda-media' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(financingService.publishLine(c, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gerente edita cadastros e condições, mas não o financiamento', async () => {
    const c = ctx('GERENTE');
    await expect(developmentsService.list(c)).resolves.toBeDefined();
    await expect(financingService.publishLine(c, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('só o admin lista e altera usuários; gerente e corretor recebem ForbiddenError', async () => {
    const novo = { name: 'Novo', email: 'novo@teste.invalid', role: 'ADMIN', brokerId: '', active: true, password: 'senha-comprida-2' };
    for (const role of ['GERENTE', 'CORRETOR'] as Role[]) {
      await expect(usersService.list(ctx(role))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(usersService.save(ctx(role), undefined, novo)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(usersService.save(ctx(role), users[role].id, { ...novo, email: `${role.toLowerCase()}@teste.invalid` })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await t.db.user.count({ where: { email: 'novo@teste.invalid' } })).toBe(0);
    const { users: list, brokers } = await usersService.list(ctx('ADMIN'));
    expect(new Set(list.map((u) => u.role))).toEqual(new Set(['ADMIN', 'CORRETOR', 'GERENTE']));
    expect(brokers.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toMatch(/argon|passwordHash/);
  });

  it('nada foi gravado pelas tentativas negadas', async () => {
    expect(await t.db.auditLog.count({ where: { actor: users.CORRETOR.id } })).toBe(0);
  });
});

describe('condições: rascunho → diff → publicar', () => {
  it('o diff mostra só o que mudou e o preview usa o rascunho sem gravar', async () => {
    const values = { ...devValues, 'cash.discountRatio': '12' };
    const check = await checkConditionDraft(ctx('GERENTE'), { developmentId: lumenId, values, validFrom: NEXT });
    expect(check.errors).toEqual({});
    expect(check.changes.map((c) => c.path)).toEqual(['cash.discountRatio']);
    const before = await t.db.salesCondition.count();
    const preview = await previewConditionService(ctx('GERENTE'), { developmentId: lumenId, unitId, profileId: 'renda-media', values, referenceDate: NEXT });
    expect(preview.conditionVersion).toBeNull();
    expect(preview.modes.find((m) => m.mode === 'A_VISTA')?.preview?.result.cash?.discountRatio).toBe(0.12);
    expect(await t.db.salesCondition.count()).toBe(before);
  });

  it('publicar muda a próxima simulação do bot e a auditoria guarda o usuário e o motivo', async () => {
    const lead = await t.db.lead.create({ data: { phone: '5500944440000', name: 'Bia', birthDate: new Date('1990-03-05'), source: 'WHATSAPP', developmentId: lumenId, status: 'IN_PROGRESS' } });
    const before = await runAndRecordPaymentSimulation(t.db, { leadId: lead.id, unitId, mode: 'A_VISTA', referenceDate: NEXT });
    const res = await publishConditionDraft(ctx('GERENTE'), { developmentId: lumenId, values: { ...devValues, 'cash.discountRatio': '12' }, validFrom: NEXT, reason: 'campanha de novembro' });
    const after = await runAndRecordPaymentSimulation(t.db, { leadId: lead.id, unitId, mode: 'A_VISTA', referenceDate: NEXT });
    expect(after.salesConditionVersion).toBe(res.created.version);
    expect(after.result.cash?.discountRatio).toBe(0.12);
    expect(after.result.cash?.amountToPay).not.toBe(before.result.cash?.amountToPay);
    const { rows } = await listAuditLogs(t.db, { entity: 'SalesCondition', actor: users.GERENTE.id });
    expect(rows.find((r) => r.action === 'SALES_CONDITION_PUBLISHED')).toMatchObject({ actorName: 'GERENTE', reason: 'campanha de novembro', entityId: res.created.id });
  });

  it('recusa: sem motivo, vigência retroativa, nada mudou e campo inválido', async () => {
    const same = { developmentId: lumenId, values: { ...devValues, 'cash.discountRatio': '12' }, validFrom: NEXT, reason: 'x' };
    await expect(publishConditionDraft(ctx('ADMIN'), { ...same, reason: ' ' })).rejects.toMatchObject({ fields: { reason: expect.any(String) } });
    await expect(publishConditionDraft(ctx('ADMIN'), { ...same, validFrom: '2026-01-02' })).rejects.toMatchObject({ fields: { _: expect.stringContaining('retroativa') } });
    await expect(publishConditionDraft(ctx('ADMIN'), same)).rejects.toMatchObject({ fields: { _: expect.any(String) } });
    await expect(publishConditionDraft(ctx('ADMIN'), { ...same, values: { ...devValues, 'cash.discountRatio': 'abc' } })).rejects.toMatchObject({ fields: { 'cash.discountRatio': expect.any(String) } });
  });
});

describe('login', () => {
  it('abre e fecha a sessão, audita com o usuário e recusa senha errada com a mesma mensagem', async () => {
    const ok = await signIn(t.db, { email: 'admin@teste.invalid', password: 'senha-comprida-1' });
    if (!ok.ok) throw new Error('deveria entrar');
    expect((await userForToken(t.db, ok.token))?.role).toBe('ADMIN');
    await signOut(t.db, ok.token, ok.user.id);
    expect(await userForToken(t.db, ok.token)).toBeNull();
    const actions = (await t.db.auditLog.findMany({ where: { actor: ok.user.id, entity: 'User' }, orderBy: { id: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(['USER_LOGIN', 'USER_LOGOUT']);
    const wrongPass = await signIn(t.db, { email: 'admin@teste.invalid', password: 'errada-errada' });
    const wrongUser = await signIn(t.db, { email: 'ninguem@teste.invalid', password: 'errada-errada' });
    expect(wrongPass).toEqual(wrongUser);
    expect(await userForToken(t.db, undefined)).toBeNull();
    expect(await userForToken(t.db, 'token-inventado')).toBeNull();
  });
});
