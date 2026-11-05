'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { assignBrokerAction, eraseLeadAction, releaseHandoffAction, takeHandoffAction } from './actions';

function Result({ state }: { state: FormState }) {
  if (state.ok) return <Notice kind="ok">{state.ok}</Notice>;
  if (state.error) return <Notice kind="error">{state.error}</Notice>;
  return null;
}

export function AssignBroker({ leadId, current, brokers }: { leadId: string; current: string | null; brokers: { id: string; name: string }[] }) {
  const [state, dispatch] = useActionState<FormState, FormData>(assignBrokerAction.bind(null, leadId), {});
  return (
    <form action={dispatch} className="inline-form" aria-label="Atribuir corretor">
      <label>Corretor
        <select name="brokerId" defaultValue={current ?? ''}>
          <option value="">Sem corretor</option>
          {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <SubmitButton variant="ghost">Salvar corretor</SubmitButton>
      {state.fields?.brokerId ? <span className="error" role="alert">{state.fields.brokerId}</span> : null}
      <Result state={state} />
    </form>
  );
}

export function HandoffButtons({ leadId, canTake, canRelease }: { leadId: string; canTake: boolean; canRelease: boolean }) {
  const [taken, take] = useActionState<FormState>(takeHandoffAction.bind(null, leadId), {});
  const [released, release] = useActionState<FormState>(releaseHandoffAction.bind(null, leadId), {});
  return (
    <div className="inline-form">
      {canTake ? <form action={take}><SubmitButton pendingLabel="Assumindo…">Assumir conversa</SubmitButton></form> : null}
      {canRelease ? <form action={release}><SubmitButton variant="ghost" pendingLabel="Devolvendo…">Devolver ao bot</SubmitButton></form> : null}
      <Result state={taken} />
      <Result state={released} />
    </div>
  );
}

export function EraseLead({ leadId }: { leadId: string }) {
  const [state, dispatch] = useActionState<FormState, FormData>(eraseLeadAction.bind(null, leadId), {});
  return (
    <details>
      <summary>Pedir a exclusão dos dados deste lead</summary>
      <form action={dispatch} className="stack">
        <p className="small">Apaga o lead, a conversa, as simulações e os consentimentos, e abre a limpeza do histórico no WhatsApp. <strong>Não dá para desfazer.</strong> Fica só um registro mínimo na auditoria, com o seu nome.</p>
        <div className="field">
          <label htmlFor="confirmation">Digite EXCLUIR para confirmar</label>
          <input id="confirmation" name="confirmation" autoComplete="off" aria-invalid={state.fields?.confirmation ? true : undefined} />
          {state.fields?.confirmation ? <span className="error" role="alert">{state.fields.confirmation}</span> : null}
        </div>
        <div className="inline-form"><SubmitButton variant="danger" pendingLabel="Excluindo…">Excluir dados do lead</SubmitButton></div>
        <Result state={state} />
      </form>
    </details>
  );
}
