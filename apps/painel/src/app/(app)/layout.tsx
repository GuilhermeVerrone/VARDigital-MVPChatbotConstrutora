import Link from 'next/link';
import { Notice } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import { ROLE_LABEL } from '@/lib/format';
import { can, NAV_ITEMS } from '@/lib/permissions';
import { requirePage } from '@/lib/server';
import { logoutAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePage('home');
  return (
    <div className="shell">
      <a className="skip" href="#main">Ir para o conteúdo</a>
      <aside className="side">
        <p className="brand">Elevare<span> · painel</span></p>
        <nav aria-label="Principal">
          <ul>
            {NAV_ITEMS.filter((i) => can(user.role, i.permission)).map((i) => (
              <li key={i.href}><Link href={i.href}>{i.label}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="who">
          <p><strong>{user.name}</strong><br /><span className="muted small">{ROLE_LABEL[user.role]}</span></p>
          <Link className="account" href="/conta">Minha conta</Link>
          <form action={logoutAction}><SubmitButton variant="ghost" pendingLabel="Saindo…">Sair</SubmitButton></form>
        </div>
      </aside>
      <main id="main" className="main">
        {user.mustChangePassword ? (
          <Notice kind="info">
            Sua senha foi definida por outra pessoa (ou é a senha de demonstração). <Link href="/conta">Troque agora em Minha conta</Link>.
          </Notice>
        ) : null}
        {children}
      </main>
    </div>
  );
}
