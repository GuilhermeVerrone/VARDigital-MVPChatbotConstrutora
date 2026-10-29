import {
  ChannelError,
  type ChannelAdapter,
  type OptionItem,
  type Presence,
  type SentMessage,
} from './types';

export interface WaAkgAdapterOptions {
  /** Ex.: http://wa-akg:3000 (sem /api). */
  baseUrl: string;
  apiKey: string;
  sessionId: string;
  timeoutMs?: number;
  /** Injetável para teste. */
  fetch?: typeof fetch;
}

/**
 * Cliente da API REST do WA-AKG (v1.7.0). Rotas: /api/messages/{sessão}/{jid}/{send|list|media},
 * /api/chat/{sessão}/{jid}/{presence|read}. A sessão fica fixa no adaptador.
 */
export class WaAkgAdapter implements ChannelAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: WaAkgAdapterOptions) {
    if (!opts.apiKey) throw new Error('WaAkgAdapter: apiKey vazia');
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async sendText(chatId: string, text: string): Promise<SentMessage> {
    const body = await this.request('POST', this.messagePath(chatId, 'send'), { json: { message: { text } } });
    return { externalId: extractMessageId(body) };
  }

  async sendList(
    chatId: string,
    args: { title: string; options: OptionItem[]; footer?: string },
  ): Promise<SentMessage> {
    // legacyText: lista numerada em texto puro. Botões/lista nativos não foram verificados
    // em número real (docs/fases/fase-0.md); texto numerado funciona em qualquer cliente.
    const body = await this.request('POST', this.messagePath(chatId, 'list'), {
      json: {
        title: args.title,
        options: args.options.map((o) => o.title),
        ...(args.footer ? { footer: args.footer } : {}),
        legacyText: true,
      },
    });
    return { externalId: extractMessageId(body) };
  }

  async sendDocument(
    chatId: string,
    args: { data: Uint8Array; fileName: string; mimeType: string; caption?: string },
  ): Promise<SentMessage> {
    const form = new FormData();
    form.set('type', 'document');
    form.set('file', new Blob([args.data as Uint8Array<ArrayBuffer>], { type: args.mimeType }), args.fileName);
    if (args.caption) form.set('caption', args.caption);
    const body = await this.request('POST', this.messagePath(chatId, 'media'), { form });
    return { externalId: extractMessageId(body) };
  }

  async setPresence(chatId: string, presence: Presence): Promise<void> {
    await this.request('POST', this.chatPath(chatId, 'presence'), { json: { presence } });
  }

  async markRead(chatId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.request('PUT', this.chatPath(chatId, 'read'), { json: { messageIds } });
  }

  private messagePath(chatId: string, action: string) {
    return `/api/messages/${encodeURIComponent(this.opts.sessionId)}/${encodeURIComponent(chatId)}/${action}`;
  }

  private chatPath(chatId: string, action: string) {
    return `/api/chat/${encodeURIComponent(this.opts.sessionId)}/${encodeURIComponent(chatId)}/${action}`;
  }

  private async request(
    method: 'POST' | 'PUT',
    path: string,
    payload: { json?: unknown; form?: FormData },
  ): Promise<unknown> {
    const headers: Record<string, string> = { 'X-API-Key': this.opts.apiKey };
    if (payload.json !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.opts.baseUrl), {
        method,
        headers,
        body: payload.form ?? JSON.stringify(payload.json),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Rede, DNS, timeout: transitório.
      throw new ChannelError(`WA-AKG indisponível: ${(err as Error).message}`, true);
    }

    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* corpo não-JSON: tratado abaixo pelo status */
    }

    const apiFailed = typeof body === 'object' && body !== null && (body as { status?: unknown }).status === false;
    if (res.ok && !apiFailed) return body;

    const reason = errorText(body) ?? `HTTP ${res.status}`;
    // 5xx (inclui 503 "sessão não pronta"), 408 e 429 são transitórios; 400/401/403/404 não passam sozinhos.
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429 || (res.ok && apiFailed);
    throw new ChannelError(`WA-AKG recusou (${res.status}): ${reason}`, retryable, res.status);
  }
}

function errorText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as { error?: unknown; message?: unknown };
  const v = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : null;
  return v ? v.slice(0, 200) : null;
}

/** A API devolve `{status, data: <retorno do Baileys>}`; o id fica em `data.key.id`. */
function extractMessageId(body: unknown): string | null {
  const id = (body as { data?: { key?: { id?: unknown } } } | null)?.data?.key?.id;
  return typeof id === 'string' ? id : null;
}
