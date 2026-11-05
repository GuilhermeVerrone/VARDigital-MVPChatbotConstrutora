'use client';

import { useActionState } from 'react';
import { Notice, TextField } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack">
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      <TextField name="email" label="E-mail" type="email" inputMode="email" required />
      <TextField name="password" label="Senha" type="password" required />
      <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}
