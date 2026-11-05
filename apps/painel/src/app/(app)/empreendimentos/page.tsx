import Link from 'next/link';
import { PageHeader } from '@/components/fields';
import { brl, dateBr } from '@/lib/format';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { developmentsService } from '@/lib/services';

export const metadata = { title: 'Empreendimentos' };

export default async function Empreendimentos() {
  const { user, ctx } = await requirePage('developments:read');
  const list = await developmentsService.list(ctx);
  return (
    <>
      <PageHeader title="Empreendimentos">
        {can(user.role, 'developments:write') ? <Link className="btn primary" href="/empreendimentos/novo">Novo empreendimento</Link> : null}
      </PageHeader>
      <table>
        <thead>
          <tr><th scope="col">Nome</th><th scope="col">Entrega</th><th scope="col">Unidades</th><th scope="col">A partir de</th><th scope="col">Situação</th><th scope="col"><span className="sr">Ações</span></th></tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id}>
              <th scope="row"><Link href={`/empreendimentos/${d.id}`}>{d.name}</Link><br /><span className="muted small">{d.city}</span></th>
              <td>{dateBr(d.deliveryDate)}</td>
              <td>{d.units.available} disp. · {d.units.reserved} res. · {d.units.sold} vend.</td>
              <td>{d.minPrice === null ? '—' : brl(d.minPrice, 0)}</td>
              <td>
                <span className={`badge ${d.published ? 'ok' : 'muted'}`}>{d.published ? 'No site' : 'Fora do site'}</span>{' '}
                {!d.active ? <span className="badge bad">Inativo</span> : null}{' '}
                {d.dataStatus === 'ILUSTRATIVO' ? <span className="badge warn">Ilustrativo</span> : null}
              </td>
              <td><Link href={`/empreendimentos/${d.id}/condicoes`}>Condições</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
