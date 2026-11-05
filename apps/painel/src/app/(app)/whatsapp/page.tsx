import Link from 'next/link';
import { PageHeader } from '@/components/fields';
import { dateTimeBr } from '@/lib/format';
import { requirePage } from '@/lib/server';
import { whatsappService } from '@/lib/services';
import { WHATSAPP_LABEL } from '@/lib/whatsapp';

export const metadata = { title: 'WhatsApp' };
export const dynamic = 'force-dynamic';

const uptime = (s: number) => (s >= 86_400 ? `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

export default async function Whatsapp() {
  const { ctx } = await requirePage('whatsapp:read');
  const s = await whatsappService.status(ctx);
  const kind = s.state === 'CONNECTED' ? 'ok' : s.state === 'DISCONNECTED' ? 'bad' : 'warn';
  return (
    <>
      <PageHeader title="Status do WhatsApp" />
      <section className="card line" aria-live="polite">
        <h2 style={{ marginTop: 0 }}>Sessão {s.sessionId ?? '—'} <span className={`badge ${kind}`}>{WHATSAPP_LABEL[s.state]}</span></h2>
        <dl>
          <div className="kv"><dt>Status informado pelo WA-AKG</dt><dd>{s.reported ?? '—'}</dd></div>
          {s.uptimeSeconds !== null ? <div className="kv"><dt>Conectada há</dt><dd>{uptime(s.uptimeSeconds)}</dd></div> : null}
          <div className="kv"><dt>Consultado em</dt><dd>{dateTimeBr(s.checkedAt)}</dd></div>
        </dl>
        {s.state === 'DISCONNECTED' ? <p className="notice error">A sessão não está conectada: o bot não recebe nem envia mensagens. Reconecte pelo WA-AKG (leitura do QR) e atualize esta tela.</p> : null}
        {s.state === 'UNREACHABLE' ? <p className="notice error">Não foi possível consultar o WA-AKG. Confira se o serviço está no ar e se a chave de API está correta (variáveis do painel).</p> : null}
        {s.state === 'NOT_CONFIGURED' ? <p className="notice info">Defina WA_AKG_BASE_URL, WA_AKG_API_KEY e WA_AKG_SESSION_ID no ambiente do painel.</p> : null}
        <p><Link className="btn ghost" href="/whatsapp">Atualizar</Link></p>
      </section>
      <p className="muted small">O painel só consulta o status. Conectar, reiniciar ou ler o QR continua sendo feito no WA-AKG.</p>
    </>
  );
}
