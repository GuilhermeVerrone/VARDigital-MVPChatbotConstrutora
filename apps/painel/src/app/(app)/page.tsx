import Link from 'next/link';
import { getSalesConditionInForce, todayIso } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { dateBr, MODE_LABEL } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { developmentsService, leadsService, whatsappService } from '@/lib/services';
import { WHATSAPP_LABEL } from '@/lib/whatsapp';

export const metadata = { title: 'Início' };

const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

export default async function Home() {
  const { user, ctx } = await requirePage('home');
  const isManager = can(user.role, 'developments:read');
  const [dash, wa, developments] = await Promise.all([
    leadsService.dashboard(ctx),
    can(user.role, 'whatsapp:read') ? whatsappService.status(ctx) : Promise.resolve(null),
    isManager ? developmentsService.list(ctx) : Promise.resolve([]),
  ]);
  const today = todayIso();
  const conditions = await Promise.all(developments.map(async (d) => ({ d, c: await getSalesConditionInForce(ctx.db, d.id, today).catch(() => null) })));
  const top = dash.funnel[0]!.count;
  return (
    <>
      <PageHeader title={`Olá, ${user.name}`} />
      {user.role === 'CORRETOR' ? <p className="muted">Os números abaixo são só dos leads atribuídos a você.</p> : null}

      <section className="cards" aria-label="Hoje">
        <div className="card"><p className="num">{dash.today.total}</p><p>leads hoje ({dash.today.fromSite} pelo site, {dash.today.fromWhatsapp} pelo WhatsApp)</p></div>
        <div className="card"><p className="num">{dash.waitingHandoff}</p><p>{dash.waitingHandoff === 1 ? 'conversa aguardando corretor' : 'conversas aguardando corretor'}{dash.waitingHandoff > 0 ? <> · <Link href="/leads?status=HANDOFF">ver</Link></> : null}</p></div>
        {wa ? <div className="card"><p className="num" style={{ fontSize: '1.2rem' }}><span className={`badge ${wa.state === 'CONNECTED' ? 'ok' : wa.state === 'DISCONNECTED' ? 'bad' : 'warn'}`}>{WHATSAPP_LABEL[wa.state]}</span></p><p>WhatsApp · <Link href="/whatsapp">detalhes</Link></p></div> : null}
      </section>

      <section aria-labelledby="funil">
        <h2 id="funil">Funil do formulário do site</h2>
        <ol className="funnel">
          {dash.funnel.map((f, i) => (
            <li key={f.key}>
              <span className="funnel-label">{f.label}</span>
              <span className="funnel-bar" aria-hidden="true"><span style={{ width: `${top === 0 ? 0 : Math.max(2, (f.count / top) * 100)}%` }} /></span>
              <span className="funnel-num"><strong>{f.count}</strong> <span className="muted small">{i === 0 ? '' : `${pct(f.count, top)} do total`}</span></span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="modos">
        <h2 id="modos">Simulações por forma de pagamento</h2>
        {dash.byMode.length === 0 ? <p className="muted">Nenhuma simulação ainda.</p> : (
          <table>
            <thead><tr><th scope="col">Forma de pagamento</th><th scope="col">Leads</th></tr></thead>
            <tbody>{dash.byMode.map((m) => <tr key={m.mode ?? 'mvp'}><th scope="row">{m.mode ? MODE_LABEL[m.mode] : 'Financiamento (MVP)'}</th><td>{m.count}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      {isManager ? (
        <section>
          <h2>Condições comerciais vigentes</h2>
          <table>
            <thead><tr><th scope="col">Empreendimento</th><th scope="col">Versão</th><th scope="col">Situação</th><th scope="col">Desde</th></tr></thead>
            <tbody>
              {conditions.map(({ d, c }) => (
                <tr key={d.id}>
                  <th scope="row"><Link href={`/empreendimentos/${d.id}/condicoes`}>{d.name}</Link></th>
                  <td>{c ? c.version : '—'}</td>
                  <td>{c ? <span className={`badge ${c.condition.status === 'VALIDADO' ? 'ok' : 'warn'}`}>{c.condition.status === 'VALIDADO' ? 'Validado' : 'Ilustrativo'}</span> : <span className="badge bad">Sem condição</span>}</td>
                  <td>{c ? dateBr(c.validFrom) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
