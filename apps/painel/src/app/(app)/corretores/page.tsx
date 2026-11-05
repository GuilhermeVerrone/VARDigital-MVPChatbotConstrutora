import { PageHeader } from '@/components/fields';
import { can } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { brokersService } from '@/lib/services';
import { BrokerRow } from './BrokerRow';

export const metadata = { title: 'Corretores' };

export default async function Corretores() {
  const { user, ctx } = await requirePage('brokers:read');
  const brokers = await brokersService.list(ctx);
  const canWrite = can(user.role, 'brokers:write');
  return (
    <>
      <PageHeader title="Corretores" />
      <p className="muted">Só corretores ativos recebem leads novos. Desativar não apaga o histórico. O telefone é o WhatsApp que recebe o aviso do lead.</p>
      <div className="broker-grid">
        <div className="broker-head" aria-hidden="true"><span>Nome</span><span>WhatsApp</span><span>E-mail</span><span>Equipe</span><span>Situação</span><span /></div>
        {brokers.map((b) => <BrokerRow key={b.id} broker={b} canWrite={canWrite} />)}
        {canWrite ? <BrokerRow canWrite /> : null}
      </div>
    </>
  );
}
