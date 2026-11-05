import { PageHeader } from '@/components/fields';
import { requirePage } from '@/lib/server';
import { createDevelopmentAction } from '../actions';
import { DevelopmentForm } from '../DevelopmentForm';

export const metadata = { title: 'Novo empreendimento' };

export default async function Novo() {
  await requirePage('developments:write');
  return (
    <>
      <PageHeader title="Novo empreendimento" back={{ href: '/empreendimentos', label: 'Empreendimentos' }} />
      <p className="muted">O empreendimento nasce fora do site. Cadastre as unidades e a condição comercial antes de publicar.</p>
      <DevelopmentForm action={createDevelopmentAction} create canWrite />
    </>
  );
}
