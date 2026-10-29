import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { claimNextInbound, completeInbound, enqueueInbound, failInbound } from '../src';
import { createTestDb, type TestDb } from './db';

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await t.sql('delete from processed_messages');
});

const base = { channel: 'WHATSAPP' as const, sessionId: 'piloto', chatKey: '5511900000001@s.whatsapp.net' };
const opts = { lockMs: 60_000, maxAttempts: 3 };
const T0 = new Date('2026-10-29T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const enqueue = (externalId: string, extra: Partial<Parameters<typeof enqueueInbound>[1]> = {}) =>
  enqueueInbound(t.db, { ...base, externalId, payload: { text: `msg ${externalId}` }, receivedAt: at(0), ...extra });

describe('enqueueInbound', () => {
  it('reentrega do mesmo key.id não cria segunda linha nem altera a primeira', async () => {
    expect(await enqueue('A1')).toBe(true);
    expect(await enqueueInbound(t.db, { ...base, externalId: 'A1', payload: { text: 'outro conteúdo' } })).toBe(false);
    const rows = await t.db.processedMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ text: 'msg A1' });
  });

  it('mesmo id em outra sessão é outra mensagem', async () => {
    expect(await enqueue('A1')).toBe(true);
    expect(await enqueue('A1', { sessionId: 'outra' })).toBe(true);
  });

  it('entregas simultâneas do mesmo id resultam em uma linha', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => enqueue('RACE')));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await t.db.processedMessage.count()).toBe(1);
  });
});

describe('claimNextInbound', () => {
  it('devolve null com a fila vazia', async () => {
    expect(await claimNextInbound(t.db, { ...opts, now: T0 })).toBeNull();
  });

  it('reserva a mensagem, conta a tentativa e não entrega a mesma duas vezes', async () => {
    await enqueue('A1');
    const first = await claimNextInbound(t.db, { ...opts, now: at(1) });
    expect(first).toMatchObject({ externalId: 'A1', attempts: 1, payload: { text: 'msg A1' } });
    expect(await claimNextInbound(t.db, { ...opts, now: at(2) })).toBeNull();
  });

  it('claims concorrentes nunca pegam a mesma linha', async () => {
    for (let i = 0; i < 6; i++) await enqueue(`M${i}`, { chatKey: `chat-${i}`, receivedAt: at(i) });
    const got = await Promise.all(Array.from({ length: 10 }, () => claimNextInbound(t.db, { ...opts, now: at(100) })));
    const ids = got.filter((x) => x !== null).map((x) => x.externalId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('worker que caiu: depois de lockMs outro retoma a mesma mensagem', async () => {
    await enqueue('A1');
    await claimNextInbound(t.db, { ...opts, now: at(0) });
    expect(await claimNextInbound(t.db, { ...opts, now: at(59_000) })).toBeNull();
    const retaken = await claimNextInbound(t.db, { ...opts, now: at(61_000) });
    expect(retaken).toMatchObject({ externalId: 'A1', attempts: 2 });
  });

  it('mantém a ordem dentro da conversa e deixa outras conversas andarem', async () => {
    await enqueue('A1', { receivedAt: at(0) });
    await enqueue('A2', { receivedAt: at(10) });
    await enqueue('B1', { chatKey: 'outro-chat', receivedAt: at(20) });

    const a1 = await claimNextInbound(t.db, { ...opts, now: at(100) });
    expect(a1?.externalId).toBe('A1');
    // A2 espera A1; B1 é de outra conversa e passa.
    expect((await claimNextInbound(t.db, { ...opts, now: at(101) }))?.externalId).toBe('B1');
    expect(await claimNextInbound(t.db, { ...opts, now: at(102) })).toBeNull();

    await completeInbound(t.db, a1!.id, { now: at(103) });
    expect((await claimNextInbound(t.db, { ...opts, now: at(104) }))?.externalId).toBe('A2');
  });

  it('mensagem em backoff segura as seguintes da conversa até a hora de tentar de novo', async () => {
    await enqueue('A1', { receivedAt: at(0) });
    await enqueue('A2', { receivedAt: at(10) });
    const a1 = await claimNextInbound(t.db, { ...opts, now: at(100) });
    await failInbound(t.db, a1!.id, { error: 'timeout', retryAt: at(5_000) });

    expect(await claimNextInbound(t.db, { ...opts, now: at(1_000) })).toBeNull();
    expect((await claimNextInbound(t.db, { ...opts, now: at(5_000) }))?.externalId).toBe('A1');
  });

  it('reserva vencida que esgotou as tentativas vira DEAD e libera a conversa', async () => {
    await enqueue('A1', { receivedAt: at(0) });
    await enqueue('A2', { receivedAt: at(10) });
    const o = { lockMs: 1_000, maxAttempts: 2 };
    await claimNextInbound(t.db, { ...o, now: at(0) });
    await claimNextInbound(t.db, { ...o, now: at(2_000) }); // 2ª tentativa; o worker cai de novo

    const next = await claimNextInbound(t.db, { ...o, now: at(10_000) });
    const a1 = await t.db.processedMessage.findFirstOrThrow({ where: { externalId: 'A1' } });
    expect(a1.status).toBe('DEAD');
    expect(next?.externalId).toBe('A2');
  });
});

describe('completeInbound / failInbound', () => {
  it('concluir apaga o conteúdo e guarda só os identificadores', async () => {
    await enqueue('A1');
    const item = await claimNextInbound(t.db, { ...opts, now: at(1) });
    expect(await completeInbound(t.db, item!.id, { now: at(2) })).toBe(true);

    const row = await t.db.processedMessage.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'DONE', payload: null, lockedUntil: null, externalId: 'A1' });
    expect(row.processedAt).toEqual(at(2));
    expect(await claimNextInbound(t.db, { ...opts, now: at(10_000_000) })).toBeNull();
  });

  it('só conclui quem está com a reserva (linha já concluída ou pendente é ignorada)', async () => {
    await enqueue('A1');
    const row = await t.db.processedMessage.findFirstOrThrow();
    expect(await completeInbound(t.db, row.id)).toBe(false);
    expect(await failInbound(t.db, row.id, { error: 'x', retryAt: null })).toBe(false);
    expect((await t.db.processedMessage.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('falha com retryAt volta para PENDING com o erro registrado; sem retryAt vira DEAD', async () => {
    await enqueue('A1');
    const item = await claimNextInbound(t.db, { ...opts, now: at(1) });
    await failInbound(t.db, item!.id, { error: 'WA-AKG 503', retryAt: at(9_000) });
    let row = await t.db.processedMessage.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'PENDING', lastError: 'WA-AKG 503', lockedUntil: null });
    expect(row.availableAt).toEqual(at(9_000));
    expect(row.payload).toEqual({ text: 'msg A1' });

    const again = await claimNextInbound(t.db, { ...opts, now: at(9_000) });
    await failInbound(t.db, again!.id, { error: 'definitivo', retryAt: null });
    row = await t.db.processedMessage.findFirstOrThrow();
    expect(row.status).toBe('DEAD');
  });
});
