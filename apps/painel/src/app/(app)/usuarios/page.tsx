import Link from 'next/link';
import { PageHeader } from '@/components/fields';
import { requirePage } from '@/lib/server';
import { usersService } from '@/lib/services';
import { UserRow } from './UserRow';

export const metadata = { title: 'Usuários' };

export default async function Usuarios() {
  const { user, ctx } = await requirePage('users:read');
  const { users, brokers } = await usersService.list(ctx);
  const now = new Date();
  return (
    <>
      <PageHeader title="Usuários" />
      <p className="muted">
        Quem entra no painel. <strong>Administrador</strong> faz tudo; <strong>gerente</strong> faz tudo menos mudar o financiamento e os usuários;
        <strong> corretor</strong> vê só os próprios leads e precisa estar vinculado a um cadastro de <Link href="/corretores">Corretores</Link>.
        Desativar, mudar o papel ou redefinir a senha encerra as sessões abertas do usuário.
      </p>
      <div className="user-grid">
        <div className="user-head" aria-hidden="true"><span>Nome</span><span>E-mail</span><span>Papel</span><span>Corretor vinculado</span><span>Senha</span><span>Situação</span><span /></div>
        {users.map((u) => (
          <UserRow
            key={u.id}
            self={u.id === user.id}
            brokers={brokers}
            user={{ id: u.id, name: u.name, email: u.email, role: u.role, brokerId: u.brokerId, active: u.active, locked: !!u.lockedUntil && u.lockedUntil > now }}
          />
        ))}
        <UserRow brokers={brokers} />
      </div>
    </>
  );
}
