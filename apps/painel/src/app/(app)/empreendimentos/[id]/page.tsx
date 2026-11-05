import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PanelNotFoundError } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { developmentsService } from '@/lib/services';
import { updateDevelopmentAction } from '../actions';
import { DevelopmentForm } from '../DevelopmentForm';
import { PublishToggle } from '../PublishToggle';
import { UnitRow } from '../UnitRow';

export const metadata = { title: 'Empreendimento' };

export default async function EmpreendimentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, ctx } = await requirePage('developments:read');
  const d = await developmentsService.get(ctx, id).catch((e) => {
    if (e instanceof PanelNotFoundError || (e instanceof Error && /uuid|Inconsistent column data/i.test(e.message))) notFound();
    throw e;
  });
  const canWrite = can(user.role, 'developments:write');
  return (
    <>
      <PageHeader title={d.name} back={{ href: '/empreendimentos', label: 'Empreendimentos' }}>
        {can(user.role, 'conditions:read') ? <Link className="btn ghost" href={`/empreendimentos/${d.id}/condicoes`}>Condições comerciais</Link> : null}
      </PageHeader>
      <PublishToggle id={d.id} published={d.published} canWrite={canWrite} />
      <section aria-labelledby="dados">
        <h2 id="dados">Dados</h2>
        <DevelopmentForm action={updateDevelopmentAction.bind(null, d.id)} values={d} canWrite={canWrite} />
      </section>
      <section aria-labelledby="unidades">
        <h2 id="unidades">Unidades</h2>
        <div className="unit-grid">
          <div className="unit-head" aria-hidden="true"><span>Código</span><span>Tipologia</span><span>m²</span><span>Preço (R$)</span><span>Status</span><span /></div>
          {d.units.map((u) => <UnitRow key={u.id} developmentId={d.id} unit={u} canWrite={canWrite} />)}
          {canWrite ? <UnitRow developmentId={d.id} canWrite /> : null}
        </div>
      </section>
    </>
  );
}
