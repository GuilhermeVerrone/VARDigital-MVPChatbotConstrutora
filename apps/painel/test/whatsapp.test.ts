import { describe, expect, it } from 'vitest';
import { fetchWhatsappStatus } from '../src/lib/whatsapp';

const env = { baseUrl: 'http://wa-akg:3000/', apiKey: 'segredo-da-api', sessionId: 'piloto' };
const json = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const NOW = new Date('2026-11-05T12:00:00Z');

describe('status do WhatsApp (WA-AKG)', () => {
  it('conectado: lê o status e o tempo de conexão', async () => {
    const calls: { url: string; key: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, key: (init.headers as Record<string, string>)['X-API-Key']! });
      return new Response(JSON.stringify({ status: 'Connected', uptime: 3600.7 }));
    }) as unknown as typeof fetch;
    const s = await fetchWhatsappStatus(env, { fetch: f, now: () => NOW });
    expect(s).toMatchObject({ state: 'CONNECTED', reported: 'Connected', uptimeSeconds: 3600, sessionId: 'piloto', checkedAt: NOW });
    expect(calls).toEqual([{ url: 'http://wa-akg:3000/api/sessions/piloto', key: 'segredo-da-api' }]);
  });

  it('qualquer status que não seja conectado é desconectado (QR, parado, deslogado)', async () => {
    for (const status of ['SCAN_QR', 'STOPPED', 'LOGGED_OUT']) {
      const s = await fetchWhatsappStatus(env, { fetch: json(200, { status, uptime: 99 }) });
      expect(s).toMatchObject({ state: 'DISCONNECTED', reported: status, uptimeSeconds: null });
    }
  });

  it('erro de rede, resposta de erro e corpo torto viram "não foi possível consultar", sem vazar a chave', async () => {
    const down = (async () => { throw new Error('connect ECONNREFUSED segredo-da-api'); }) as unknown as typeof fetch;
    for (const f of [down, json(401, { error: 'x' }), json(500, {}), (async () => new Response('<html>')) as unknown as typeof fetch]) {
      const s = await fetchWhatsappStatus(env, { fetch: f });
      expect(s.state).toBe('UNREACHABLE');
      expect(JSON.stringify(s)).not.toContain('segredo-da-api');
    }
  });

  it('sem URL, chave ou sessão: não configurado, sem chamar a rede', async () => {
    const f = (async () => { throw new Error('não deveria chamar'); }) as unknown as typeof fetch;
    for (const e of [{}, { ...env, apiKey: '' }, { ...env, baseUrl: undefined }, { ...env, sessionId: undefined }]) {
      expect((await fetchWhatsappStatus(e, { fetch: f })).state).toBe('NOT_CONFIGURED');
    }
  });
});
