import { MIN_PASSWORD_LENGTH } from '@mvp/db/panel';
import { PageHeader } from '@/components/fields';
import { ROLE_LABEL } from '@/lib/format';
import { requirePage } from '@/lib/server';
import { PasswordForm } from './PasswordForm';

export const metadata = { title: 'Minha conta' };

export default async function Conta() {
  const { user } = await requirePage('home');
  return (
    <>
      <PageHeader title="Minha conta" />
      <p className="muted">{user.name} · {ROLE_LABEL[user.role]}. Para mudar o nome, o e-mail ou o papel, fale com o administrador.</p>
      <h2>Trocar senha</h2>
      <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
    </>
  );
}
