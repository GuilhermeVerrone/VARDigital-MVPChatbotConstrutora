'use client';

import { useActionState } from 'react';
import { Notice, TextField } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { changePasswordAction } from './actions';

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, {});
  const f = state.fields ?? {};
  return (
    <form action={action} className="stack narrow" aria-label="Trocar senha">
      {state.ok ? <Notice kind="ok">{state.ok}</Notice> : null}
      <TextField name="current" label="Senha atual" type="password" error={f.current} required />
      <TextField name="next" label="Nova senha" type="password" error={f.next} hint={`Pelo menos ${minLength} caracteres. Uma frase curta é mais fácil de lembrar e mais forte.`} required />
      <TextField name="confirm" label="Repita a nova senha" type="password" error={f.confirm} required />
      <SubmitButton pendingLabel="Trocando…">Trocar senha</SubmitButton>
    </form>
  );
}
