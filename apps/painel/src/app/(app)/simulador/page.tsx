import Link from 'next/link';
import { PageHeader } from '@/components/fields';
import { requirePage } from '@/lib/server';
import { flowService } from '@/lib/services';
import { Simulator } from './Simulator';

export const metadata = { title: 'Simulador de conversa' };

export default async function Simulador() {
  const { ctx } = await requirePage('simulator:use');
  const [overview, developments] = await Promise.all([
    flowService.overview(ctx),
    ctx.db.development.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return (
    <>
      <PageHeader title="Simulador de conversa">
        <Link className="btn ghost" href="/fluxo">Editar o fluxo</Link>
      </PageHeader>
      <p className="muted">Conversa com o bot sem WhatsApp, usando o rascunho ou a versão publicada e o mesmo cálculo de simulação do bot. Percorra os três modos de pagamento escolhendo a forma de pagamento na conversa.</p>
      <Simulator developments={developments} hasDraft={overview.draft !== null} hasPublished={overview.published !== null} />
    </>
  );
}
