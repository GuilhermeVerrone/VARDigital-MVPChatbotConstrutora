import { describe, expect, it } from 'vitest';
import type { ChannelAdapter, InboundMessage } from '@mvp/channel';
import { createEchoHandler, echoReply } from '../src/handlers/echo';

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  channel: 'WHATSAPP',
  sessionId: 'piloto',
  externalId: 'M1',
  chatId: '5511987654321@s.whatsapp.net',
  phone: '5511987654321',
  pushName: null,
  type: 'text',
  text: 'olá',
  receivedAt: '2026-10-29T12:00:00.000Z',
  ...over,
});

function recorder(fail: Partial<Record<'markRead' | 'setPresence' | 'sendText', Error>> = {}) {
  const calls: string[] = [];
  const channel = {
    markRead: async () => {
      calls.push('markRead');
      if (fail.markRead) throw fail.markRead;
    },
    setPresence: async (_c: string, p: string) => {
      calls.push(`presence:${p}`);
      if (fail.setPresence) throw fail.setPresence;
    },
    sendText: async (_c: string, t: string) => {
      calls.push(`send:${t}`);
      if (fail.sendText) throw fail.sendText;
      return { externalId: 'OUT' };
    },
  } as unknown as ChannelAdapter;
  return { calls, channel };
}
const noSleep = async () => undefined;

describe('echo', () => {
  it('lê, mostra "digitando…", responde e volta a "pausado"', async () => {
    const { calls, channel } = recorder();
    await createEchoHandler(channel, { sleep: noSleep })(msg());
    expect(calls).toEqual(['markRead', 'presence:composing', 'send:Eco: olá', 'presence:paused']);
  });

  it('falha em leitura/presença não impede a resposta', async () => {
    const { calls, channel } = recorder({ markRead: new Error('x'), setPresence: new Error('y') });
    await createEchoHandler(channel, { sleep: noSleep })(msg());
    expect(calls).toContain('send:Eco: olá');
  });

  it('falha no envio propaga (o worker reagenda) e ainda limpa a presença', async () => {
    const { calls, channel } = recorder({ sendText: new Error('503') });
    await expect(createEchoHandler(channel, { sleep: noSleep })(msg())).rejects.toThrow('503');
    expect(calls.at(-1)).toBe('presence:paused');
  });

  it('tipo sem texto recebe aviso em vez de eco', () => {
    expect(echoReply(msg({ type: 'audio', text: null }))).toMatch(/só entendo texto/);
  });

  it('o tempo de "digitando" tem teto', async () => {
    const waits: number[] = [];
    const { channel } = recorder();
    await createEchoHandler(channel, { maxTypingMs: 1500, sleep: async (ms) => void waits.push(ms) })(msg({ text: 'x'.repeat(500) }));
    expect(waits).toEqual([1500]);
  });
});
