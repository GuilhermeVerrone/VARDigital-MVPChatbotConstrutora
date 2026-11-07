import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, seedElevare } from '../src';
import { listAdminUsers, PanelValidationError, savePanelUser } from '../src/panel-entry';
import { createTestDb, type TestDb } from './db';

const TODAY = '2026-11-05';
const NOW = new Date('2026-11-05T12:00:00Z');
let t: TestDb;
let admin: string;
let brokerA: string;
let brokerB: string;

beforeAll(async () => {
  t = await createTestDb();
  await seedElevare(t.db, { today: TODAY, adminPassword: 'senha-do-admin-1' });
  admin = (await t.db.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id;
  const brokers = await t.db.broker.findMany({ orderBy: { name: 'asc' } });
  brokerA = brokers[0]!.id;
  brokerB = brokers[1]!.id;
});
afterAll(() => t.drop());

const base = { name: 'Rita Gerente', email: 'Rita@Teste.invalid', role: 'GERENTE', brokerId: '', active: true, password: 'senha-inicial-1' };
const audit = (entityId: string) => t.db.auditLog.findMany({ where: { entity: 'User', entityId }, orderBy: { id: 'asc' } });

describe('usuários do painel', () => {
  it('cria com e-mail normalizado, entra com a senha inicial e audita sem a senha', async () => {
    const u = await savePanelUser(t.db, { actor: admin, data: base });
    expect(u).toMatchObject({ email: 'rita@teste.invalid', role: 'GERENTE', brokerId: null, active: true });
    expect((await login(t.db, { email: 'rita@teste.invalid', password: 'senha-inicial-1', now: NOW })).ok).toBe(true);
    const rows = await audit(u.id);
    expect(rows.map((r) => r.action)).toEqual(['USER_CREATED']);
    expect(JSON.stringify(rows[0]!.after)).not.toMatch(/senha|password|argon/i);
    expect((await listAdminUsers(t.db)).find((r) => r.id === u.id)).toMatchObject({ name: 'Rita Gerente', brokerName: null });
  });

  it('recusa e-mail repetido, senha curta, falta de senha na criação e corretor sem vínculo', async () => {
    await expect(savePanelUser(t.db, { actor: admin, data: base })).rejects.toMatchObject({ fields: { email: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, data: { ...base, email: 'x@teste.invalid', password: 'curta' } })).rejects.toMatchObject({ fields: { password: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, data: { ...base, email: 'y@teste.invalid', password: '' } })).rejects.toMatchObject({ fields: { password: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, data: { ...base, email: 'z@teste.invalid', role: 'CORRETOR' } })).rejects.toMatchObject({ fields: { brokerId: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, data: { ...base, email: 'w@teste.invalid', role: 'CHEFE' } })).rejects.toBeInstanceOf(PanelValidationError);
  });

  it('corretor fica vinculado a um único corretor; o vínculo some se o papel deixa de ser corretor', async () => {
    const c = await savePanelUser(t.db, { actor: admin, data: { ...base, name: 'Caio', email: 'caio@teste.invalid', role: 'CORRETOR', brokerId: brokerA } });
    expect(c.brokerId).toBe(brokerA);
    await expect(savePanelUser(t.db, { actor: admin, data: { ...base, name: 'Outro', email: 'outro@teste.invalid', role: 'CORRETOR', brokerId: brokerA } }))
      .rejects.toMatchObject({ fields: { brokerId: expect.any(String) } });
    const g = await savePanelUser(t.db, { actor: admin, id: c.id, data: { ...base, name: 'Caio', email: 'caio@teste.invalid', role: 'GERENTE', brokerId: brokerB, password: '' } });
    expect(g.brokerId).toBeNull();
    expect((await audit(c.id)).at(-1)).toMatchObject({ action: 'USER_UPDATED', before: { role: 'CORRETOR', brokerId: brokerA }, after: { role: 'GERENTE', brokerId: null } });
  });

  it('desativar e redefinir a senha encerram as sessões; redefinir desbloqueia', async () => {
    const u = await savePanelUser(t.db, { actor: admin, data: { ...base, name: 'Bia', email: 'bia@teste.invalid' } });
    const edit = { ...base, name: 'Bia', email: 'bia@teste.invalid', password: '' };
    expect((await login(t.db, { email: 'bia@teste.invalid', password: 'senha-inicial-1', now: NOW })).ok).toBe(true);
    await savePanelUser(t.db, { actor: admin, id: u.id, data: { ...edit, active: false } });
    expect(await t.db.userSession.count({ where: { userId: u.id } })).toBe(0);
    expect(await login(t.db, { email: 'bia@teste.invalid', password: 'senha-inicial-1', now: NOW })).toMatchObject({ ok: false, reason: 'INACTIVE' });
    expect((await audit(u.id)).at(-1)!.action).toBe('USER_DEACTIVATED');

    await t.db.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(NOW.getTime() + 60 * 60_000), failedLogins: 3 } });
    await savePanelUser(t.db, { actor: admin, id: u.id, data: { ...edit, active: true, password: 'senha-nova-123' } });
    const after = await t.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after).toMatchObject({ lockedUntil: null, failedLogins: 0, active: true });
    expect((await login(t.db, { email: 'bia@teste.invalid', password: 'senha-nova-123', now: NOW })).ok).toBe(true);
    expect((await audit(u.id)).slice(-2).map((r) => r.action)).toEqual(['USER_ACTIVATED', 'USER_PASSWORD_RESET']);
  });

  it('salvar sem mudar nada não grava auditoria', async () => {
    const u = await savePanelUser(t.db, { actor: admin, data: { ...base, name: 'Igual', email: 'igual@teste.invalid' } });
    await savePanelUser(t.db, { actor: admin, id: u.id, data: { ...base, name: 'Igual', email: 'igual@teste.invalid', password: '' } });
    expect((await audit(u.id)).map((r) => r.action)).toEqual(['USER_CREATED']);
  });

  it('quem altera não muda o próprio papel, não se desativa nem troca a própria senha por aqui', async () => {
    const me = await t.db.user.findUniqueOrThrow({ where: { id: admin } });
    const self = { name: me.name, email: me.email, role: 'ADMIN', brokerId: '', active: true, password: '' };
    await expect(savePanelUser(t.db, { actor: admin, id: admin, data: { ...self, role: 'GERENTE' } })).rejects.toMatchObject({ fields: { role: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, id: admin, data: { ...self, active: false } })).rejects.toMatchObject({ fields: { active: expect.any(String) } });
    await expect(savePanelUser(t.db, { actor: admin, id: admin, data: { ...self, password: 'outra-senha-123' } })).rejects.toMatchObject({ fields: { password: expect.any(String) } });
  });

  it('o painel sempre fica com um administrador ativo', async () => {
    const other = await savePanelUser(t.db, { actor: admin, data: { ...base, name: 'Ana Admin', email: 'ana-admin@teste.invalid', role: 'ADMIN' } });
    // Com dois admins, o novo pode rebaixar o original.
    await savePanelUser(t.db, { actor: other.id, id: admin, data: { name: 'Admin', email: (await t.db.user.findUniqueOrThrow({ where: { id: admin } })).email, role: 'GERENTE', brokerId: '', active: true, password: '' } });
    // Agora `other` é o único admin: ninguém (nem um gerente com acesso indevido ao serviço) o rebaixa.
    await expect(savePanelUser(t.db, { actor: admin, id: other.id, data: { ...base, name: 'Ana Admin', email: 'ana-admin@teste.invalid', role: 'ADMIN', active: false, password: '' } }))
      .rejects.toMatchObject({ fields: { _: expect.any(String) } });
  });
});
