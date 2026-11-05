import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAYMENT_MODE_OPTIONS } from '@mvp/conversation';
import { createUser, seedElevareForTest } from './helpers';
import { createTestDb, type TestDb } from '../../../packages/db/test/db';
import { ForbiddenError, type PanelUser, type Role } from '../src/lib/permissions';
import { flowService, type ServiceCtx } from '../src/lib/services';
import { simulatorSend, simulatorStart, type SimTurn } from '../src/lib/simulator';
import { contentToValues } from '../src/lib/flow-form';

const TODAY = '2026-11-05';
let t: TestDb;
const users = {} as Record<Role, PanelUser>;
const ctx = (role: Role): ServiceCtx => ({ db: t.db, user: users[role], today: TODAY });

beforeAll(async () => {
  t = await createTestDb();
  await seedElevareForTest(t.db, TODAY);
  for (const role of ['ADMIN', 'GERENTE', 'CORRETOR'] as Role[]) {
    const broker = role === 'CORRETOR' ? await t.db.broker.findFirstOrThrow() : null;
    const u = await createUser(t.db, { name: role, email: `${role.toLowerCase()}@teste.invalid`, password: 'senha-comprida-1', role, ...(broker ? { brokerId: broker.id } : {}) });
    users[role] = { id: u.id, name: u.name, role, brokerId: u.brokerId };
  }
});
afterAll(() => t.drop());

const lastBot = (turn: SimTurn) => [...turn.messages].reverse().find((m) => m.from === 'bot')!;

/** Responde à conversa como um lead cooperativo até o resultado (ou até o limite de turnos). */
async function run(mode: 'A_VISTA' | 'ENTRADA_A_VISTA' | 'ENTRADA_PARCELADA', source: 'draft' | 'published', entry: 'WHATSAPP' | 'FORM' = 'WHATSAPP') {
  let turn = await simulatorStart(ctx('GERENTE'), { source, entry });
  const states: string[] = [turn.state];
  const answers: Record<string, string> = {
    NAME: 'Maria Souza', PHONE_CONFIRM: 'sim', PHONE: '41999990000', EMAIL: 'pular', INTEREST: '1', CONTACT_CONFIRM: 'sim',
    DOWN_CASH: '60 mil', CASH_NOW: '60 mil', DESIRED_INSTALLMENT: 'não sei', BALLOONS: 'sim', INCOME: '12000', INCOME_TYPE: '1', BIRTH: '05/03/1990', DEBTS: 'não',
    CO_ASK: 'não', FGTS_ASK: 'não', OWNS: 'não', FIRST: 'sim', CONFIRM: 'sim', DOWN: '60 mil', INSTALLMENT: 'não sei', DEVELOPMENT: '1',
  };
  for (let i = 0; i < 40 && !['RESULT', 'CASH_OFFER', 'HANDOFF', 'DONE'].includes(turn.state); i++) {
    let text = answers[turn.state];
    if (turn.state === 'PAYMENT_MODE') {
      const options = lastBot(turn).options ?? [];
      text = String(options.findIndex((o) => o === PAYMENT_MODE_OPTIONS[mode].label) + 1);
    }
    expect(text, `sem resposta para ${turn.state}`).toBeDefined();
    turn = await simulatorSend(ctx('GERENTE'), { source, snapshot: turn.snapshot, text: text! });
    states.push(turn.state);
  }
  return { turn, states };
}

describe('simulador de conversa', () => {
  it.each(['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA'] as const)('percorre o modo %s do início ao resultado, com o aviso legal travado', async (mode) => {
    const { turn, states } = await run(mode, 'published');
    expect(turn.state).toBe(mode === 'A_VISTA' ? 'CASH_OFFER' : 'RESULT');
    expect(states).toContain('PAYMENT_MODE');
    expect(turn.collected.paymentMode).toBe(mode);
    const texts = turn.messages.map((m) => m.text).join('\n');
    expect(texts).toMatch(/R\$/);
    expect(turn.messages.some((m) => m.locked)).toBe(true);
    expect(turn.messages.find((m) => m.locked)!.text).toMatch(/indicativa|não constitui aprovação/i);
    expect(await t.db.simulation.count()).toBe(0);
    expect(await t.db.lead.count()).toBe(0);
  });

  it('pelo formulário: 1ª mensagem do site, confirmação e daí em diante o mesmo fluxo', async () => {
    const start = await simulatorStart(ctx('GERENTE'), { source: 'published', entry: 'FORM' });
    expect(start.state).toBe('CONTACT_CONFIRM');
    expect(lastBot(start).text).toMatch(/Maria/);
    const { turn } = await run('ENTRADA_A_VISTA', 'published', 'FORM');
    expect(turn.state).toBe('RESULT');
  });

  it('"não" na confirmação do formulário encerra e não pergunta mais nada', async () => {
    const start = await simulatorStart(ctx('GERENTE'), { source: 'published', entry: 'FORM' });
    const end = await simulatorSend(ctx('GERENTE'), { source: 'published', snapshot: start.snapshot, text: 'não' });
    expect(end.ended).toBe(true);
    expect(end.state).toBe('OPTED_OUT');
  });

  it('o rascunho roda sem ter sido publicado; a publicada continua com o texto antigo', async () => {
    const values = contentToValues(null);
    values['text.ASK_NAME'] = 'Texto do RASCUNHO: como você se chama?';
    await flowService.saveDraft(ctx('GERENTE'), values);
    const draft = await simulatorStart(ctx('GERENTE'), { source: 'draft', entry: 'WHATSAPP' });
    const published = await simulatorStart(ctx('GERENTE'), { source: 'published', entry: 'WHATSAPP' });
    expect(draft.flowLabel).toBe('rascunho');
    expect(draft.messages.map((m) => m.text).join('\n')).toMatch(/Texto do RASCUNHO/);
    expect(published.messages.map((m) => m.text).join('\n')).not.toMatch(/RASCUNHO/);
  });

  it('o simulador só abre para quem pode (corretor não), e rejeita estado adulterado', async () => {
    await expect(simulatorStart(ctx('CORRETOR'), { source: 'published', entry: 'WHATSAPP' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(simulatorSend(ctx('CORRETOR'), { source: 'published', snapshot: {}, text: 'oi' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(simulatorSend(ctx('GERENTE'), { source: 'published', snapshot: { lixo: true }, text: 'oi' })).rejects.toThrow(/inválido/);
    await expect(simulatorSend(ctx('GERENTE'), { source: 'published', snapshot: null, text: 'oi' })).rejects.toThrow(/inválido/);
    const start = await simulatorStart(ctx('GERENTE'), { source: 'published', entry: 'WHATSAPP' });
    await expect(simulatorSend(ctx('GERENTE'), { source: 'published', snapshot: start.snapshot, text: '   ' })).rejects.toThrow();
  });
});
