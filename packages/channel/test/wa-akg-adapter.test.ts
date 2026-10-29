import { describe, expect, it } from 'vitest';
import { ChannelError, WaAkgAdapter } from '../src';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function setup(respond: (call: Call) => Response | Promise<Response> = () => Response.json({ status: true, data: { key: { id: 'OUT1' } } })) {
  const calls: Call[] = [];
  const fetchStub = (async (url: URL, init: RequestInit) => {
    const call = { url: String(url), method: String(init.method), headers: init.headers as Record<string, string>, body: init.body };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  const adapter = new WaAkgAdapter({ baseUrl: 'http://wa-akg:3000', apiKey: 'k-123', sessionId: 'piloto', fetch: fetchStub });
  return { adapter, calls };
}
const JID = '5511987654321@s.whatsapp.net';

describe('WaAkgAdapter', () => {
  it('sendText: POST /send com {message:{text}}, X-API-Key e id devolvido', async () => {
    const { adapter, calls } = setup();
    const sent = await adapter.sendText(JID, 'olá');
    expect(sent).toEqual({ externalId: 'OUT1' });
    expect(calls[0]).toMatchObject({
      url: 'http://wa-akg:3000/api/messages/piloto/5511987654321%40s.whatsapp.net/send',
      method: 'POST',
      headers: { 'X-API-Key': 'k-123', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ message: { text: 'olá' } });
  });

  it('sendList: lista numerada em texto (legacyText)', async () => {
    const { adapter, calls } = setup();
    await adapter.sendList(JID, { title: 'Escolha', options: [{ title: 'Sim' }, { title: 'Não' }], footer: 'Responda com o número' });
    expect(calls[0]!.url).toMatch(/\/list$/);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({
      title: 'Escolha',
      options: ['Sim', 'Não'],
      footer: 'Responda com o número',
      legacyText: true,
    });
  });

  it('sendDocument: multipart com type=document, arquivo e legenda', async () => {
    const { adapter, calls } = setup();
    await adapter.sendDocument(JID, { data: new TextEncoder().encode('%PDF-1.4'), fileName: 'simulacao.pdf', mimeType: 'application/pdf', caption: 'Sua simulação' });
    const form = calls[0]!.body as FormData;
    expect(calls[0]!.url).toMatch(/\/media$/);
    expect(calls[0]!.headers['Content-Type']).toBeUndefined(); // o fetch define o boundary
    expect(form.get('type')).toBe('document');
    expect(form.get('caption')).toBe('Sua simulação');
    const file = form.get('file') as File;
    expect(file.name).toBe('simulacao.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.4');
  });

  it('setPresence e markRead usam /api/chat/...', async () => {
    const { adapter, calls } = setup(() => Response.json({ status: true }));
    await adapter.setPresence(JID, 'composing');
    await adapter.markRead(JID, ['A', 'B']);
    expect(calls[0]).toMatchObject({ method: 'POST', url: expect.stringMatching(/\/api\/chat\/piloto\/.+\/presence$/) });
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ presence: 'composing' });
    expect(calls[1]).toMatchObject({ method: 'PUT', url: expect.stringMatching(/\/read$/) });
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ messageIds: ['A', 'B'] });
  });

  it('markRead sem ids não chama a API (evitaria marcar a conversa toda)', async () => {
    const { adapter, calls } = setup();
    await adapter.markRead(JID, []);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [503, true],
    [500, true],
    [429, true],
    [400, false],
    [401, false],
    [404, false],
  ])('HTTP %i → retryable=%s', async (status, retryable) => {
    const { adapter } = setup(() => Response.json({ status: false, error: 'Session not ready' }, { status }));
    const err = await adapter.sendText(JID, 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toMatchObject({ retryable, status });
  });

  it('200 com status:false no corpo também é falha (e transitória)', async () => {
    const { adapter } = setup(() => Response.json({ status: false, message: 'socket closed' }));
    await expect(adapter.sendText(JID, 'x')).rejects.toMatchObject({ retryable: true });
  });

  it('erro de rede/timeout é retryable', async () => {
    const adapter = new WaAkgAdapter({
      baseUrl: 'http://wa-akg:3000',
      apiKey: 'k',
      sessionId: 'piloto',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(adapter.setPresence(JID, 'paused')).rejects.toMatchObject({ name: 'ChannelError', retryable: true });
  });

  it('a API key não vaza na mensagem de erro', async () => {
    const { adapter } = setup(() => Response.json({ status: false, error: 'nope' }, { status: 401 }));
    const err = (await adapter.sendText(JID, 'x').catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain('k-123');
  });

  it('exige apiKey', () => {
    expect(() => new WaAkgAdapter({ baseUrl: 'http://x', apiKey: '', sessionId: 's' })).toThrow(/apiKey/);
  });
});
