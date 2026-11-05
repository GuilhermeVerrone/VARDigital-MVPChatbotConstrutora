'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { setPublishedAction } from './actions';

export function PublishToggle({ id, published, canWrite }: { id: string; published: boolean; canWrite: boolean }) {
  const [state, dispatch] = useActionState<FormState>(setPublishedAction.bind(null, id, !published), {});
  return (
    <form action={dispatch} className="inline-form">
      <span className={`badge ${published ? 'ok' : 'muted'}`}>{published ? 'Publicado no site' : 'Fora do site'}</span>
      {canWrite ? <SubmitButton variant="ghost" pendingLabel="Aguarde…">{published ? 'Tirar do site' : 'Publicar no site'}</SubmitButton> : null}
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
    </form>
  );
}
