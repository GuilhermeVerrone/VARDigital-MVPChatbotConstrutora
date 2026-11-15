'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import { ROLE_LABEL } from '@/lib/format';
import { saveUserAction, type UserFormState } from './actions';

export interface UserValues { id: string; name: string; email: string; role: keyof typeof ROLE_LABEL; brokerId: string | null; active: boolean; locked: boolean }
export interface BrokerOption { id: string; name: string; active: boolean }

const ROLES = Object.entries(ROLE_LABEL) as [keyof typeof ROLE_LABEL, string][];

/** Uma linha editável. `self` = o próprio usuário logado: papel e situação ficam travados (o servidor confere de novo). */
export function UserRow({ user, brokers, self = false }: { user?: UserValues; brokers: BrokerOption[]; self?: boolean }) {
  const [state, dispatch] = useActionState<UserFormState, FormData>(saveUserAction.bind(null, user?.id), {});
  const f = state.fields ?? {};
  const key = user?.id ?? 'new';
  const sent = state.sent;
  const val = (k: keyof NonNullable<UserFormState['sent']> & string, fallback: string | undefined) => sent?.[k] ?? fallback;
  const err = (k: string) => (f[k] ? <span className="error" role="alert">{f[k]}</span> : null);
  // Corretores ativos, mais o vinculado atual (mesmo inativo), para não sumir da lista.
  const options = brokers.filter((b) => b.active || b.id === user?.brokerId);
  return (
    <form action={dispatch} className="user-row" aria-label={user ? `Usuário ${user.name}` : 'Novo usuário'}>
      <div><label className="sr" htmlFor={`n-${key}`}>Nome</label><input id={`n-${key}`} name="name" defaultValue={val('name', user?.name)} placeholder="Nome" autoComplete="off" />{err('name')}</div>
      <div><label className="sr" htmlFor={`e-${key}`}>E-mail</label><input id={`e-${key}`} name="email" type="email" inputMode="email" defaultValue={val('email', user?.email)} placeholder="E-mail de acesso" autoComplete="off" />{err('email')}</div>
      <div>
        <label className="sr" htmlFor={`r-${key}`}>Papel</label>
        {self ? <input type="hidden" name="role" value={user!.role} /> : null}
        <select id={`r-${key}`} name={self ? undefined : 'role'} defaultValue={val('role', user?.role ?? 'CORRETOR')} disabled={self}>
          {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {err('role')}
      </div>
      <div>
        <label className="sr" htmlFor={`b-${key}`}>Corretor vinculado</label>
        <select id={`b-${key}`} name="brokerId" defaultValue={val('brokerId', user?.brokerId ?? '')}>
          <option value="">— (só para corretor)</option>
          {options.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (inativo)'}</option>)}
        </select>
        {err('brokerId')}
      </div>
      <div>
        <label className="sr" htmlFor={`p-${key}`}>{user ? 'Nova senha' : 'Senha inicial'}</label>
        <input id={`p-${key}`} name="password" type="password" autoComplete="new-password" placeholder={user ? (self ? 'Use Minha conta' : 'Nova senha (opcional)') : 'Senha inicial'} disabled={self} />
        {err('password')}
      </div>
      <div className="check-cell">
        {self ? <input type="hidden" name="active" value="on" /> : null}
        <label><input type="checkbox" name={self ? undefined : 'active'} defaultChecked={sent ? sent.active === 'on' : (user?.active ?? true)} disabled={self} /> Ativo</label>
        {err('active')}
      </div>
      <div className="unit-actions">
        {self ? <span className="badge">Você</span> : null}
        {user?.locked ? <span className="badge warn" title="Bloqueado por tentativas erradas. Redefinir a senha desbloqueia.">Bloqueado</span> : null}
        <SubmitButton variant={user ? 'ghost' : 'primary'}>{user ? 'Salvar' : 'Adicionar'}</SubmitButton>
        {state.ok ? <span className="ok-text" role="status">{state.ok}</span> : null}
        {state.error && Object.keys(f).length === 0 ? <span className="error" role="alert">{state.error}</span> : null}
      </div>
    </form>
  );
}
