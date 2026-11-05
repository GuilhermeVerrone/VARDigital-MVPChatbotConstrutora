import { redirect } from 'next/navigation';
import { getUser } from '@/lib/server';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entrar' };

export default async function LoginPage() {
  if (await getUser()) redirect('/');
  return (
    <main className="login">
      <section className="login-card" aria-labelledby="t">
        <p className="eyebrow">Elevare Construtora</p>
        <h1 id="t">Painel de atendimento</h1>
        <p className="muted">Entre com o seu acesso para gerenciar empreendimentos, condições comerciais e corretores.</p>
        <LoginForm />
      </section>
    </main>
  );
}
