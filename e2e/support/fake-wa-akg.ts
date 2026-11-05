import { createServer, type Server } from 'node:http';

// WA-AKG falso para o e2e: aceita as rotas de envio do adaptador (texto, lista, documento, presença,
// leitura) e a consulta da sessão do painel, e guarda o que o bot "enviou" para o teste conferir.
// Também permite simular a queda do gateway (POST /_outage?n=3 → as próximas 3 chamadas de envio dão 503).

export interface SentMessage {
  at: number;
  /** JID do destinatário, como o bot enviou. */
  to: string;
  kind: 'text' | 'list' | 'document';
  text: string;
  fileName?: string;
}

export interface FakeWaAkg {
  port: number;
  sent: SentMessage[];
  close(): Promise<void>;
}

export async function startFakeWaAkg(port: number, apiKey: string): Promise<FakeWaAkg> {
  const sent: SentMessage[] = [];
  let outage = 0;
  let seq = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const body = Buffer.concat(chunks);
      const json = (code: number, data: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data));

      // Rotas de controle do teste (sem chave).
      if (url.pathname === '/_sent') return json(200, sent);
      if (url.pathname === '/_outage') {
        outage = Number(url.searchParams.get('n') ?? '0');
        return json(200, { outage });
      }
      if (url.pathname === '/_reset') {
        sent.length = 0;
        outage = 0;
        return json(200, { ok: true });
      }

      if (req.headers['x-api-key'] !== apiKey) return json(401, { status: false, message: 'chave inválida' });

      if (req.method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) return json(200, { status: 'CONNECTED', uptime: 4321 });

      const m = /^\/api\/messages\/[^/]+\/([^/]+)\/(send|list|media)$/.exec(url.pathname);
      if (req.method === 'POST' && m) {
        if (outage > 0) {
          outage -= 1;
          return json(503, { status: false, message: 'sessão não está pronta' });
        }
        const to = decodeURIComponent(m[1]!);
        const raw = body.toString('latin1');
        if (m[2] === 'send') {
          const data = JSON.parse(body.toString('utf8')) as { message?: { text?: string } };
          sent.push({ at: Date.now(), to, kind: 'text', text: data.message?.text ?? '' });
        } else if (m[2] === 'list') {
          const data = JSON.parse(body.toString('utf8')) as { title?: string; options?: string[]; footer?: string };
          sent.push({ at: Date.now(), to, kind: 'list', text: [data.title, ...(data.options ?? []).map((o, i) => `${i + 1}. ${o}`), data.footer].filter(Boolean).join('\n') });
        } else {
          const fileName = /filename="([^"]+)"/.exec(raw)?.[1] ?? 'arquivo';
          const caption = /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(raw)?.[1] ?? '';
          sent.push({ at: Date.now(), to, kind: 'document', text: Buffer.from(caption, 'latin1').toString('utf8'), fileName });
        }
        return json(200, { status: true, data: { key: { id: `FAKE${++seq}` } } });
      }
      // presença, leitura e o resto: aceita.
      return json(200, { status: true, data: { key: { id: `FAKE${++seq}` } } });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { port, sent, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
