import { getFinancingView, listAuditLogs, todayIso } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { dateBr, dateTimeBr } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { FinancingLineForm } from './FinancingLineForm';

export const metadata = { title: 'Financiamento simulado' };

export default async function Financiamento() {
  const { user, ctx } = await requirePage('financing:read');
  const today = todayIso();
  const [view, audit] = await Promise.all([getFinancingView(ctx.db, today), listAuditLogs(ctx.db, { entity: 'ParameterSet', take: 8 })]);
  const canWrite = can(user.role, 'financing:write');
  return (
    <>
      <PageHeader title="Financiamento simulado" />
      <p className="lead">
        Estas linhas alimentam a estimativa do financiamento do saldo nas chaves. Cada alteração cria uma <strong>nova versão</strong> dos parâmetros (as antigas ficam no histórico) e vale para as próximas simulações do bot.
      </p>
      <p>
        Versão vigente: <strong>{view.version}</strong> (desde {dateBr(view.validFrom)}) ·{' '}
        <span className={`badge ${view.status === 'VALIDADO' ? 'ok' : 'warn'}`}>{view.status === 'VALIDADO' ? 'Validado' : 'Ilustrativo'}</span>
      </p>
      {!canWrite ? <p className="muted">Somente o administrador altera o financiamento. Você pode consultar os valores.</p> : null}
      {view.lines.map((l) => (
        <FinancingLineForm
          key={l.id}
          line={{ id: l.id, name: l.name, annualInterestRate: l.annualInterestRate, termMin: l.termMonths.min, termMax: l.termMonths.max, systems: l.systems, maxIncomeCommitment: l.maxIncomeCommitment }}
          defaultSystem={view.defaultSystem}
          today={today}
          canWrite={canWrite}
        />
      ))}
      <section aria-labelledby="alt">
        <h2 id="alt">Últimas alterações</h2>
        {audit.rows.length === 0 ? <p className="muted">Nenhuma alteração registrada.</p> : (
          <table>
            <thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">Ação</th><th scope="col">Motivo</th></tr></thead>
            <tbody>{audit.rows.map((r) => <tr key={String(r.id)}><td>{dateTimeBr(r.at)}</td><td>{r.actorName}</td><td>{r.action}</td><td>{r.reason ?? '—'}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
