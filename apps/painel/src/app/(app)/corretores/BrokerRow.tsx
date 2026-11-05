'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { saveBrokerAction } from './actions';

export interface BrokerValues { id?: string; name: string; phone: string; email: string | null; team: string | null; active: boolean; leads?: number }

export function BrokerRow({ broker, canWrite }: { broker?: BrokerValues; canWrite: boolean }) {
  const [state, dispatch] = useActionState<FormState, FormData>(saveBrokerAction.bind(null, broker?.id), {});
  const f = state.fields ?? {};
  const key = broker?.id ?? 'new';
  const err = (k: string) => (f[k] ? <span className="error" role="alert">{f[k]}</span> : null);
  return (
    <form action={dispatch} className="broker-row" aria-label={broker ? `Corretor ${broker.name}` : 'Novo corretor'}>
      <div><label className="sr" htmlFor={`n-${key}`}>Nome</label><input id={`n-${key}`} name="name" defaultValue={broker?.name} placeholder="Nome" disabled={!canWrite} />{err('name')}</div>
      <div><label className="sr" htmlFor={`p-${key}`}>WhatsApp</label><input id={`p-${key}`} name="phone" inputMode="tel" defaultValue={broker?.phone} placeholder="5541999990000" disabled={!canWrite} />{err('phone')}</div>
      <div><label className="sr" htmlFor={`e-${key}`}>E-mail</label><input id={`e-${key}`} name="email" inputMode="email" defaultValue={broker?.email ?? ''} placeholder="E-mail (opcional)" disabled={!canWrite} />{err('email')}</div>
      <div><label className="sr" htmlFor={`t-${key}`}>Equipe</label><input id={`t-${key}`} name="team" defaultValue={broker?.team ?? ''} placeholder="Equipe" disabled={!canWrite} /></div>
      <div className="check-cell"><label><input type="checkbox" name="active" defaultChecked={broker?.active ?? true} disabled={!canWrite} /> Ativo</label></div>
      <div className="unit-actions">
        {broker ? <span className="muted small">{broker.leads} leads</span> : null}
        {canWrite ? <SubmitButton variant={broker ? 'ghost' : 'primary'}>{broker ? 'Salvar' : 'Adicionar'}</SubmitButton> : null}
        {state.ok ? <span className="ok-text" role="status">{state.ok}</span> : null}
        {state.error && !state.fields ? <span className="error" role="alert">{state.error}</span> : null}
      </div>
    </form>
  );
}
