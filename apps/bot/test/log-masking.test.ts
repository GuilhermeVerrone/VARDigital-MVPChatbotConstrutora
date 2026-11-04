import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '@mvp/channel';
import type { ClaimedMessage, InboxReader } from '../src/inbox';
import { LOG_REDACT_PATHS, maskText, safeError } from '../src/lib/mask';
import { createWorker } from '../src/worker';

// Fase 7: nenhum telefone, e-mail, nome ou valor de renda em claro nos logs nem em last_error.

describe('maskText', () => {
  it('mascara JID, telefone em vários formatos, e-mail, valores em reais e sequências longas de dígitos', () => {
    expect(maskText('falha para 5513981264295@s.whatsapp.net')).toBe('falha para *********4295@s.whatsapp.net');
    expect(maskText('ligar para (13) 98126-4295 ou +55 13 98126-4295 ou 13981264295')).not.toMatch(/9812|98126|1398126/);
    expect(maskText('ligar para (13) 98126-4295')).toBe('ligar para ***4295');
    expect(maskText('contato maria.silva@gmail.com falhou')).toBe('contato ***@gmail.com falhou');
    expect(maskText('renda de R$ 7.500,00 e entrada R$40000')).toBe('renda de R$ *** e entrada R$ ***');
    expect(maskText('CPF 123.456.789-09')).not.toMatch(/123|456|789/);
  });
  it('não altera texto sem dado pessoal e mantém números curtos', () => {
    expect(maskText('conexão recusada após 3 tentativas (HTTP 503)')).toBe('conexão recusada após 3 tentativas (HTTP 503)');
  });
  it('safeError aceita qualquer coisa e limita o tamanho', () => {
    expect(safeError(new Error('boom 5513981264295'))).not.toContain('981264295');
    expect(safeError('texto')).toBe('texto');
    expect(safeError(new Error('x'.repeat(2000))).length).toBe(500);
  });
});

const msg: InboundMessage = {
  channel: 'WHATSAPP', sessionId: 'piloto', externalId: 'abc', chatId: '5513981264295@s.whatsapp.net', phone: '5513981264295',
  pushName: 'Maria da Silva', type: 'text', text: 'minha renda é 7500', receivedAt: '2026-10-29T12:00:00.000Z',
};

describe('worker: erro com dado pessoal', () => {
  it('o log e o last_error guardam o erro mascarado', async () => {
    const queue: ClaimedMessage[] = [{ id: 'row', attempts: 5, message: msg }];
    const failed: string[] = [];
    const inbox: InboxReader = { claim: async () => queue.shift() ?? null, complete: async () => undefined, fail: async (_id, e) => void failed.push(e) };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const w = createWorker({
      inbox, log, maxAttempts: 5, pollMs: 5,
      handle: async () => { throw new Error('Unique constraint failed on phone 5513981264295 (maria@gmail.com, R$ 7.500,00)'); },
    });
    w.start();
    await vi.waitFor(() => expect(failed.length).toBe(1));
    await w.stop();
    const everything = JSON.stringify([failed, log.error.mock.calls, log.warn.mock.calls, log.info.mock.calls]);
    for (const pii of ['5513981264295', '981264295', 'maria@gmail.com', '7.500', 'Maria da Silva']) expect(everything).not.toContain(pii);
    expect(failed[0]).toContain('4295'); // o final do número ajuda a achar o caso sem identificar a pessoa
  });
});

describe('logger do bot (redact)', () => {
  it('campos pessoais logados por engano saem como [redacted]', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const app = Fastify({ logger: { level: 'info', stream, redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } } });
    app.log.info({ phone: '5513981264295', lead: { name: 'Maria da Silva', email: 'maria@gmail.com', income: 7500 }, message: msg, messageId: 'abc' }, 'teste');
    app.log.info({ job: { payload: { text: 'oi' }, id: 'j1' } }, 'job');
    await app.close();
    const out = lines.join('');
    for (const pii of ['5513981264295', 'Maria da Silva', 'maria@gmail.com', '7500', 'minha renda']) expect(out).not.toContain(pii);
    expect(out).toContain('"messageId":"abc"'); // os ids continuam visíveis
    expect(out).toContain('"id":"j1"');
  });
});
