import Link from 'next/link';
import { PageHeader } from '@/components/fields';
import { requirePage } from '@/lib/server';

export const metadata = { title: 'Acesso negado' };

export default async function AcessoNegado() {
  await requirePage('home');
  return (
    <>
      <PageHeader title="Acesso negado" />
      <p>O seu papel não tem permissão para abrir esta área. Se precisa dela, fale com o administrador.</p>
      <p><Link href="/">Voltar ao início</Link></p>
    </>
  );
}
