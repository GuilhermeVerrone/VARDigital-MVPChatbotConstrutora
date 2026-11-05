import Link from 'next/link';
import { auditFilterOptions, listAuditLogs, type AuditFilter } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { dateTimeBr } from '@/lib/format';
import { requirePage } from '@/lib/server';

export const metadata = { title: 'Auditoria' };

type Search = { entity?: string; action?: string; actor?: string; from?: string; to?: string; before?: string };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function Auditoria({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx } = await requirePage('audit:read');
  const q = await searchParams;
  const filter: AuditFilter = {
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.actor ? { actor: q.actor } : {}),
    ...(q.from && ISO.test(q.from) ? { from: q.from } : {}),
    ...(q.to && ISO.test(q.to) ? { to: q.to } : {}),
    ...(q.before && /^\d+$/.test(q.before) ? { before: BigInt(q.before) } : {}),
    take: 50,
  };
  const [{ rows, next }, options] = await Promise.all([listAuditLogs(ctx.db, filter), auditFilterOptions(ctx.db)]);
  const more = new URLSearchParams(Object.entries({ ...q, before: next === null ? '' : String(next) }).filter(([, v]) => v) as [string, string][]);
  return (
    <>
      <PageHeader title="Auditoria" />
      <form method="get" className="filters" aria-label="Filtros">
        <label>Entidade<select name="entity" defaultValue={q.entity ?? ''}><option value="">Todas</option>{options.entities.map((e) => <option key={e}>{e}</option>)}</select></label>
        <label>Ação<select name="action" defaultValue={q.action ?? ''}><option value="">Todas</option>{options.actions.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>Usuário<select name="actor" defaultValue={q.actor ?? ''}><option value="">Todos</option>{options.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>De<input type="date" name="from" defaultValue={q.from ?? ''} /></label>
        <label>Até<input type="date" name="to" defaultValue={q.to ?? ''} /></label>
        <button className="btn primary" type="submit">Filtrar</button>
        <Link className="btn ghost" href="/auditoria">Limpar</Link>
      </form>
      {rows.length === 0 ? <p className="muted">Nenhum evento com esses filtros.</p> : (
        <table>
          <thead><tr><th scope="col">Quando</th><th scope="col">Usuário</th><th scope="col">Entidade</th><th scope="col">Ação</th><th scope="col">Motivo</th><th scope="col">Detalhes</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>{dateTimeBr(r.at)}</td>
                <td>{r.actorName}</td>
                <td>{r.entity}</td>
                <td>{r.action}</td>
                <td>{r.reason ?? '—'}</td>
                <td>
                  {r.before || r.after ? (
                    <details><summary>Ver</summary><pre>{JSON.stringify({ antes: r.before, depois: r.after }, null, 2)}</pre></details>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null ? <p><Link className="btn ghost" href={`/auditoria?${more.toString()}`}>Ver eventos mais antigos</Link></p> : null}
    </>
  );
}
