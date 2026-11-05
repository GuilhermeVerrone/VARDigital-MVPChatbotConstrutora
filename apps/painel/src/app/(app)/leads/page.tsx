import Link from 'next/link';
import { LEADS_PAGE_SIZE, type LeadFilter } from '@mvp/db/panel';
import { Notice, PageHeader } from '@/components/fields';
import { dateTimeBr, LEAD_STATUS_LABEL, MODE_LABEL, phoneBr, SOURCE_LABEL, VERDICT_LABEL } from '@/lib/format';
import { requirePage } from '@/lib/server';
import { leadsService } from '@/lib/services';

export const metadata = { title: 'Leads' };

type Search = { apagado?: string; q?: string; development?: string; mode?: string; verdict?: string; status?: string; broker?: string; source?: string; page?: string };

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Leads({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, ctx } = await requirePage('leads:read');
  const q = await searchParams;
  const mode = pick(q.mode, Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]);
  const verdict = pick(q.verdict, Object.keys(VERDICT_LABEL) as (keyof typeof VERDICT_LABEL)[]);
  const status = pick(q.status, Object.keys(LEAD_STATUS_LABEL) as (keyof typeof LEAD_STATUS_LABEL)[]);
  const source = pick(q.source, Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]);
  const filter: LeadFilter = {
    ...(q.q?.trim() ? { q: q.q.trim().slice(0, 80) } : {}),
    ...(q.development && UUID.test(q.development) ? { developmentId: q.development } : {}),
    ...(mode ? { mode } : {}),
    ...(verdict ? { verdict } : {}),
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(q.broker && (q.broker === 'none' || UUID.test(q.broker)) ? { brokerId: q.broker } : {}),
    ...(q.page && /^\d+$/.test(q.page) ? { page: Number(q.page) } : {}),
  };
  const [list, options] = await Promise.all([leadsService.list(ctx, filter), leadsService.filterOptions(ctx)]);
  const isBroker = user.role === 'CORRETOR';
  const link = (page: number) => {
    const sp = new URLSearchParams(Object.entries({ ...q, page: String(page) }).filter(([, v]) => v) as [string, string][]);
    return `/leads?${sp.toString()}`;
  };
  return (
    <>
      <PageHeader title="Leads" />
      {q.apagado === '1' ? <Notice kind="ok">Dados do lead excluídos. A limpeza do histórico no WhatsApp ficou pendente.</Notice> : null}
      {isBroker ? <p className="muted">Você vê só os leads atribuídos a você.</p> : null}
      <form method="get" className="filters" aria-label="Filtros">
        <label>Busca<input type="search" name="q" defaultValue={q.q ?? ''} placeholder="Nome, telefone ou ELV-1234" /></label>
        <label>Empreendimento<select name="development" defaultValue={q.development ?? ''}><option value="">Todos</option>{options.developments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Modo<select name="mode" defaultValue={mode ?? ''}><option value="">Todos</option>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Parecer<select name="verdict" defaultValue={verdict ?? ''}><option value="">Todos</option>{Object.entries(VERDICT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={status ?? ''}><option value="">Todos</option>{Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {isBroker ? null : (
          <label>Corretor<select name="broker" defaultValue={q.broker ?? ''}><option value="">Todos</option><option value="none">Sem corretor</option>{options.brokers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (inativo)'}</option>)}</select></label>
        )}
        <label>Origem<select name="source" defaultValue={source ?? ''}><option value="">Todas</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button className="btn" type="submit">Filtrar</button>
        <Link className="btn ghost" href="/leads">Limpar</Link>
      </form>
      <p className="muted small" aria-live="polite">{list.total} {list.total === 1 ? 'lead' : 'leads'}{list.pages > 1 ? ` · página ${list.page} de ${list.pages}` : ''}</p>
      {list.rows.length === 0 ? <p className="muted">Nenhum lead com esses filtros.</p> : (
        <table>
          <thead><tr><th scope="col">Lead</th><th scope="col">Empreendimento</th><th scope="col">Modo</th><th scope="col">Parecer</th><th scope="col">Status</th><th scope="col">Corretor</th><th scope="col">Origem</th><th scope="col">Entrada</th></tr></thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row"><Link href={`/leads/${r.id}`}>{r.name ?? 'Sem nome'}</Link><br /><span className="muted small">{phoneBr(r.phone)}</span></th>
                <td>{r.development ?? '—'}</td>
                <td>{r.mode ? MODE_LABEL[r.mode] : '—'}</td>
                <td>{r.verdict ? <span className={`badge ${r.verdict === 'VIAVEL' ? 'ok' : r.verdict === 'INVIAVEL' ? 'bad' : 'warn'}`}>{VERDICT_LABEL[r.verdict]}</span> : '—'}</td>
                <td>{LEAD_STATUS_LABEL[r.status]}{r.handoff === 'WAITING' ? <> <span className="badge bad">Aguardando corretor</span></> : r.handoff === 'TAKEN' ? <> <span className="badge ok">Assumido</span></> : null}</td>
                <td>{r.broker?.name ?? <span className="muted">Sem corretor</span>}</td>
                <td>{SOURCE_LABEL[r.source]}</td>
                <td>{dateTimeBr(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.pages > 1 ? (
        <nav className="inline-form" aria-label="Páginas">
          {list.page > 1 ? <Link className="btn ghost" href={link(list.page - 1)}>← Anteriores</Link> : null}
          {list.page < list.pages ? <Link className="btn ghost" href={link(list.page + 1)}>Próximos {LEADS_PAGE_SIZE} →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
