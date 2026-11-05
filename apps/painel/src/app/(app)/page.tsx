import Link from 'next/link';
import { getSalesConditionInForce, todayIso } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { dateBr, ROLE_LABEL } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { brokersService, developmentsService } from '@/lib/services';

export const metadata = { title: 'Início' };

export default async function Home() {
  const { user, ctx } = await requirePage('home');
  if (!can(user.role, 'developments:read')) {
    return (
      <>
        <PageHeader title={`Olá, ${user.name}`} />
        <p>Seu acesso é de <strong>{ROLE_LABEL[user.role]}</strong>. A lista dos seus leads chega na próxima fase do painel.</p>
      </>
    );
  }
  const today = todayIso();
  const [developments, brokers] = await Promise.all([developmentsService.list(ctx), brokersService.list(ctx)]);
  const conditions = await Promise.all(
    developments.map(async (d) => ({ d, c: await getSalesConditionInForce(ctx.db, d.id, today).catch(() => null) })),
  );
  return (
    <>
      <PageHeader title={`Olá, ${user.name}`} />
      <section className="cards" aria-label="Resumo">
        <div className="card"><p className="num">{developments.filter((d) => d.published).length}</p><p>empreendimentos no site</p></div>
        <div className="card"><p className="num">{developments.reduce((n, d) => n + d.units.available, 0)}</p><p>unidades disponíveis</p></div>
        <div className="card"><p className="num">{brokers.filter((b) => b.active).length}</p><p>corretores ativos</p></div>
      </section>
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
    </>
  );
}
