// Status da sessão do WhatsApp pela API do WA-AKG (Fase 15). Só leitura: o painel não conecta nem
// reinicia a sessão. A chave da API fica no servidor e nunca vai para a tela; erro de rede ou de
// autenticação vira "não foi possível consultar", sem detalhe da resposta.

export type WhatsappState = 'CONNECTED' | 'DISCONNECTED' | 'UNREACHABLE' | 'NOT_CONFIGURED';

export interface WhatsappStatus {
  state: WhatsappState;
  /** Status como o WA-AKG informou (ex.: "CONNECTED", "SCAN_QR", "STOPPED"). */
  reported: string | null;
  /** Há quanto tempo a sessão está conectada, em segundos. */
  uptimeSeconds: number | null;
  sessionId: string | null;
  checkedAt: Date;
}

export interface WhatsappEnv {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  sessionId?: string | undefined;
}

export const whatsappEnvFromProcess = (): WhatsappEnv => ({
  baseUrl: process.env.WA_AKG_BASE_URL,
  apiKey: process.env.WA_AKG_API_KEY,
  sessionId: process.env.WA_AKG_SESSION_ID ?? 'piloto',
});

export async function fetchWhatsappStatus(env: WhatsappEnv, opts: { fetch?: typeof fetch; timeoutMs?: number; now?: () => Date } = {}): Promise<WhatsappStatus> {
  const now = opts.now ?? (() => new Date());
  const base = { reported: null, uptimeSeconds: null, sessionId: env.sessionId ?? null, checkedAt: now() };
  if (!env.baseUrl || !env.apiKey || !env.sessionId) return { ...base, state: 'NOT_CONFIGURED' };
  try {
    const res = await (opts.fetch ?? fetch)(`${env.baseUrl.replace(/\/+$/, '')}/api/sessions/${encodeURIComponent(env.sessionId)}`, {
      headers: { 'X-API-Key': env.apiKey },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      cache: 'no-store',
    });
    if (!res.ok) return { ...base, state: 'UNREACHABLE' };
    const body = (await res.json()) as { status?: unknown; uptime?: unknown };
    const reported = typeof body.status === 'string' ? body.status : null;
    const connected = reported?.toUpperCase() === 'CONNECTED';
    return {
      ...base,
      state: connected ? 'CONNECTED' : 'DISCONNECTED',
      reported,
      uptimeSeconds: connected && typeof body.uptime === 'number' && body.uptime >= 0 ? Math.floor(body.uptime) : null,
    };
  } catch {
    return { ...base, state: 'UNREACHABLE' };
  }
}

export const WHATSAPP_LABEL: Record<WhatsappState, string> = {
  CONNECTED: 'Conectado',
  DISCONNECTED: 'Desconectado',
  UNREACHABLE: 'Não foi possível consultar o WA-AKG',
  NOT_CONFIGURED: 'Não configurado',
};
