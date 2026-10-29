import { describe, expect, it, vi } from 'vitest';
import { ChannelError, type InboundMessage } from '@mvp/channel';
import type { ClaimedMessage, InboxReader } from '../src/inbox';
import { createWorker } from '../src/worker';

const msg = (id: string): InboundMessage => ({
  channel: 'WHATSAPP',
  sessionId: 'piloto',
  externalId: id,
  chatId: '5511987654321@s.whatsapp.net',
  phone: '5511987654321',
  pushName: null,
  type: 'text',
  text: 'oi',
  receivedAt: '2026-10-29T12:00:00.000Z',
});

/** Fila em memória que registra o desfecho de cada mensagem. */
function fakeInbox(items: ClaimedMessage[]) {
  const queue = [...items];
  const outcome = { completed: [] as string[], failed: [] as { id: string; error: string; retryAt: Date | null }[] };
  const inbox: InboxReader = {
    claim: async () => queue.shift() ?? null,
    complete: async (id) => void outcome.completed.push(id),
    fail: async (id, error, retryAt) => void outcome.failed.push({ id, error, retryAt }),
  };
  return { inbox, outcome };
}
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const claimed = (id: string, attempts = 1): ClaimedMessage => ({ id: `row-${id}`, attempts, message: msg(id) });

async function runUntilDrained(w: ReturnType<typeof createWorker>, done: () => boolean) {
  w.start();
  await vi.waitFor(() => expect(done()).toBe(true));
  await w.stop();
}

describe('worker', () => {
  it('processa em ordem e conclui cada mensagem', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1'), claimed('2')]);
    const handled: string[] = [];
    const w = createWorker({ inbox, log, maxAttempts: 3, pollMs: 5, handle: async (m) => void handled.push(m.externalId) });
    await runUntilDrained(w, () => outcome.completed.length === 2);
    expect(handled).toEqual(['1', '2']);
    expect(outcome.completed).toEqual(['row-1', 'row-2']);
    expect(outcome.failed).toEqual([]);
  });

  it('falha transitória: agenda nova tentativa com backoff, sem concluir', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1', 2)]);
    const now = new Date('2026-10-29T12:00:00.000Z');
    const w = createWorker({
      inbox,
      log,
      maxAttempts: 5,
      pollMs: 5,
      now: () => now,
      backoffMs: (n) => n * 1000,
      handle: async () => {
        throw new ChannelError('WA-AKG indisponível', true);
      },
    });
    await runUntilDrained(w, () => outcome.failed.length === 1);
    expect(outcome.failed[0]).toMatchObject({ id: 'row-1', retryAt: new Date(now.getTime() + 2000) });
    expect(outcome.completed).toEqual([]);
  });

  it('esgotou as tentativas: desiste (retryAt null)', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1', 3)]);
    const w = createWorker({ inbox, log, maxAttempts: 3, pollMs: 5, handle: async () => Promise.reject(new Error('boom')) });
    await runUntilDrained(w, () => outcome.failed.length === 1);
    expect(outcome.failed[0]).toMatchObject({ error: 'boom', retryAt: null });
  });

  it('erro permanente do canal (4xx) desiste na hora, sem gastar tentativas', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1', 1)]);
    const w = createWorker({
      inbox,
      log,
      maxAttempts: 5,
      pollMs: 5,
      handle: async () => Promise.reject(new ChannelError('jid inválido', false, 400)),
    });
    await runUntilDrained(w, () => outcome.failed.length === 1);
    expect(outcome.failed[0]!.retryAt).toBeNull();
  });

  it('uma mensagem com erro não trava as seguintes', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1'), claimed('2')]);
    const w = createWorker({
      inbox,
      log,
      maxAttempts: 3,
      pollMs: 5,
      handle: async (m) => {
        if (m.externalId === '1') throw new Error('x');
      },
    });
    await runUntilDrained(w, () => outcome.completed.length === 1 && outcome.failed.length === 1);
    expect(outcome.completed).toEqual(['row-2']);
  });

  it('erro ao consultar a fila não derruba o worker; ele segue tentando', async () => {
    let calls = 0;
    const inbox: InboxReader = {
      claim: async () => {
        calls++;
        if (calls === 1) throw new Error('connection refused');
        return calls === 2 ? claimed('1') : null;
      },
      complete: async () => undefined,
      fail: async () => undefined,
    };
    const handle = vi.fn(async () => undefined);
    const w = createWorker({ inbox, log, maxAttempts: 3, pollMs: 5, handle });
    await runUntilDrained(w, () => handle.mock.calls.length === 1);
  });

  it('stop() espera a mensagem em andamento terminar e concluí-la', async () => {
    const { inbox, outcome } = fakeInbox([claimed('1')]);
    let release!: () => void;
    let started!: () => void;
    const handlerStarted = new Promise<void>((r) => (started = r));
    const w = createWorker({
      inbox,
      log,
      maxAttempts: 3,
      pollMs: 5,
      handle: () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    });
    w.start();
    await handlerStarted;
    let stopped = false;
    const stopping = w.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false); // ainda aguardando o handler
    release();
    await stopping;
    expect(outcome.completed).toEqual(['row-1']);
  });

  it('kick() acorda o worker sem esperar o intervalo de consulta', async () => {
    const queue: ClaimedMessage[] = [];
    const inbox: InboxReader = { claim: async () => queue.shift() ?? null, complete: async () => undefined, fail: async () => undefined };
    const handle = vi.fn(async () => undefined);
    const w = createWorker({ inbox, log, maxAttempts: 3, pollMs: 60_000, handle });
    w.start();
    await new Promise((r) => setTimeout(r, 20)); // worker dorme por 60 s
    queue.push(claimed('1'));
    w.kick();
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await w.stop();
  });
});
