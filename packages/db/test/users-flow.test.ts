import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFlowDraft,
  createUser,
  discardFlowDraft,
  FlowConfigError,
  findSessionUser,
  getPublishedFlowConfig,
  hashPassword,
  InvalidPasswordError,
  listFlowConfigs,
  login,
  logout,
  MAX_FAILED_LOGINS,
  publishFlowConfig,
  purgeExpiredSessions,
  updateFlowDraft,
  verifyPassword,
} from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.drop());

const NOW = new Date('2026-11-05T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe('senha', () => {
  it('argon2id: hash diferente a cada vez, verifica certo e errado, recusa senha curta', async () => {
    const a = await hashPassword('senha-comprida-1');
    const b = await hashPassword('senha-comprida-1');
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'senha-comprida-1')).toBe(true);
    expect(await verifyPassword(a, 'senha-comprida-2')).toBe(false);
    expect(await verifyPassword('lixo', 'x')).toBe(false);
    await expect(hashPassword('curta')).rejects.toBeInstanceOf(InvalidPasswordError);
  });
});

describe('login e sessão', () => {
  it('abre sessão, guarda só o hash do token, expira e fecha', async () => {
    const user = await createUser(t.db, { name: 'Ana', email: 'Ana@Exemplo.invalid ', password: 'senha-comprida-1', role: 'ADMIN' });
    expect(user.email).toBe('ana@exemplo.invalid');
    expect(user.passwordHash).not.toContain('senha-comprida');

    const res = await login(t.db, { email: 'ANA@exemplo.invalid', password: 'senha-comprida-1', now: NOW, ip: '10.0.0.1', userAgent: 'teste' });
    if (!res.ok) throw new Error('login deveria funcionar');
    const stored = await t.db.userSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(res.token);
    expect(JSON.stringify(stored)).not.toContain(res.token);

    expect((await findSessionUser(t.db, res.token, minutes(60)))?.id).toBe(user.id);
    expect(await findSessionUser(t.db, res.token, res.expiresAt)).toBeNull();
    expect(await findSessionUser(t.db, 'token-inventado', NOW)).toBeNull();

    expect(await purgeExpiredSessions(t.db, res.expiresAt)).toBe(1);
    const again = await login(t.db, { email: 'ana@exemplo.invalid', password: 'senha-comprida-1', now: NOW });
    if (!again.ok) throw new Error('login deveria funcionar');
    await logout(t.db, again.token);
    expect(await findSessionUser(t.db, again.token, NOW)).toBeNull();
  });

  it('e-mail inexistente e senha errada têm a mesma resposta', async () => {
    await createUser(t.db, { name: 'Bia', email: 'bia@exemplo.invalid', password: 'senha-comprida-1', role: 'GERENTE' });
    expect(await login(t.db, { email: 'nao@existe.invalid', password: 'qualquer-coisa-1', now: NOW })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await login(t.db, { email: 'bia@exemplo.invalid', password: 'errada-errada-1', now: NOW })).toEqual({ ok: false, reason: 'INVALID' });
  });

  it('bloqueia após tentativas erradas, mesmo com a senha certa, até o prazo passar', async () => {
    await createUser(t.db, { name: 'Caio', email: 'caio@exemplo.invalid', password: 'senha-comprida-1', role: 'GERENTE' });
    const wrong = (now: Date) => login(t.db, { email: 'caio@exemplo.invalid', password: 'errada-errada-1', now });
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) expect(await wrong(NOW)).toEqual({ ok: false, reason: 'INVALID' });
    expect(await wrong(NOW)).toEqual({ ok: false, reason: 'LOCKED' });
    expect(await login(t.db, { email: 'caio@exemplo.invalid', password: 'senha-comprida-1', now: minutes(5) })).toEqual({ ok: false, reason: 'LOCKED' });
    expect((await login(t.db, { email: 'caio@exemplo.invalid', password: 'senha-comprida-1', now: minutes(16) })).ok).toBe(true);
  });

  it('acerto zera o contador; usuário inativo não entra', async () => {
    const u = await createUser(t.db, { name: 'Dani', email: 'dani@exemplo.invalid', password: 'senha-comprida-1', role: 'GERENTE' });
    await login(t.db, { email: 'dani@exemplo.invalid', password: 'errada-errada-1', now: NOW });
    expect((await t.db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(1);
    const ok = await login(t.db, { email: 'dani@exemplo.invalid', password: 'senha-comprida-1', now: NOW });
    expect(ok.ok).toBe(true);
    expect((await t.db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(0);

    await t.db.user.update({ where: { id: u.id }, data: { active: false } });
    expect(await login(t.db, { email: 'dani@exemplo.invalid', password: 'senha-comprida-1', now: NOW })).toEqual({ ok: false, reason: 'INACTIVE' });
    if (ok.ok) expect(await findSessionUser(t.db, ok.token, NOW)).toBeNull();
  });

  it('corretor exige vínculo com um corretor', async () => {
    await expect(createUser(t.db, { name: 'E', email: 'e@exemplo.invalid', password: 'senha-comprida-1', role: 'CORRETOR' })).rejects.toThrow(/brokerId/);
  });
});

describe('fluxo do bot (FlowConfig)', () => {
  it('sem versão publicada, o bot usa os textos do código (null)', async () => {
    expect(await getPublishedFlowConfig(t.db)).toBeNull();
  });

  it('rascunho, publicada, novo rascunho copia a vigente, publica e aposenta a anterior', async () => {
    const d1 = await createFlowDraft(t.db, { actor: 'ana', content: { texts: { ASK_NAME: 'Qual é o seu nome?' }, buttons: { CONSENT: ['Sim', 'Não'] } } });
    expect(d1.status).toBe('DRAFT');
    expect(d1.content).toEqual({ texts: { ASK_NAME: 'Qual é o seu nome?' }, optionalSteps: {}, buttons: { CONSENT: ['Sim', 'Não'] }, firstContact: null });
    await expect(createFlowDraft(t.db, { actor: 'ana' })).rejects.toBeInstanceOf(FlowConfigError);

    const edited = await updateFlowDraft(t.db, d1.id, { texts: { ASK_NAME: 'Como posso te chamar?' }, firstContact: 'Oi {nome}!' });
    expect(edited.content.texts.ASK_NAME).toBe('Como posso te chamar?');

    const p1 = await publishFlowConfig(t.db, d1.id, { actor: 'ana', reason: 'primeira versão', now: NOW });
    expect(p1.status).toBe('PUBLISHED');
    expect((await getPublishedFlowConfig(t.db))?.id).toBe(d1.id);
    await expect(updateFlowDraft(t.db, d1.id, {})).rejects.toBeInstanceOf(FlowConfigError);
    await expect(discardFlowDraft(t.db, d1.id)).rejects.toBeInstanceOf(FlowConfigError);

    const d2 = await createFlowDraft(t.db, { actor: 'bia' });
    expect(d2.content).toEqual(p1.content);
    expect(d2.basedOnId).toBe(d1.id);
    await expect(publishFlowConfig(t.db, d2.id, { actor: 'bia', reason: 'igual', now: NOW })).rejects.toThrow(/nada mudou/);
    await updateFlowDraft(t.db, d2.id, { ...d2.content, optionalSteps: { EMAIL: false } });
    const p2 = await publishFlowConfig(t.db, d2.id, { actor: 'bia', reason: 'sem e-mail', now: minutes(1) });

    expect((await getPublishedFlowConfig(t.db))?.id).toBe(p2.id);
    expect((await listFlowConfigs(t.db)).map((f) => [f.version, f.status])).toEqual([
      [p1.version, 'RETIRED'],
      [p2.version, 'PUBLISHED'],
    ]);
    const audit = await t.db.auditLog.findMany({ where: { entity: 'FlowConfig' }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => [a.action, a.actor, a.reason])).toEqual([
      ['FLOW_PUBLISHED', 'ana', 'primeira versão'],
      ['FLOW_PUBLISHED', 'bia', 'sem e-mail'],
    ]);
  });

  it('conteúdo inválido é recusado (botão com mais de 25 caracteres, texto vazio)', async () => {
    await expect(createFlowDraft(t.db, { actor: 'ana', content: { buttons: { X: ['a'.repeat(26)] } } })).rejects.toBeInstanceOf(FlowConfigError);
    await expect(createFlowDraft(t.db, { actor: 'ana', content: { texts: { X: '' } } })).rejects.toBeInstanceOf(FlowConfigError);
  });

  it('descarta o rascunho', async () => {
    const d = await createFlowDraft(t.db, { actor: 'ana' });
    await discardFlowDraft(t.db, d.id);
    expect(await t.db.flowConfig.count({ where: { status: 'DRAFT' } })).toBe(0);
  });
});
