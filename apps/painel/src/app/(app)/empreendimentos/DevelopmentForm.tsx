'use client';

import { useActionState } from 'react';
import { CheckField, Notice, TextField, Field } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';

export interface DevelopmentValues {
  slug?: string;
  name: string;
  city: string;
  address: string | null;
  description: string;
  deliveryDate: string;
  heroImage: string | null;
  highlights: string[];
  active: boolean;
}

export function DevelopmentForm({ action, values, create, canWrite }: { action: (prev: FormState, form: FormData) => Promise<FormState>; values?: DevelopmentValues; create?: boolean; canWrite: boolean }) {
  const [state, dispatch] = useActionState<FormState, FormData>(action, {});
  const f = state.fields ?? {};
  const disabled = !canWrite;
  return (
    <form action={dispatch} className="stack form-grid">
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      {state.ok ? <Notice kind="ok">{state.ok}</Notice> : null}
      {create ? <TextField name="slug" label="Identificador (slug)" hint="Letras minúsculas, números e hífen. Não muda depois." error={f.slug} /> : null}
      <TextField name="name" label="Nome" defaultValue={values?.name} error={f.name} disabled={disabled} />
      <TextField name="city" label="Cidade" defaultValue={values?.city} error={f.city} disabled={disabled} />
      <TextField name="address" label="Endereço" defaultValue={values?.address ?? ''} error={f.address} disabled={disabled} />
      <TextField name="deliveryDate" label="Entrega das chaves" type="date" defaultValue={values?.deliveryDate} error={f.deliveryDate} disabled={disabled} />
      <TextField name="heroImage" label="Imagem principal (caminho)" defaultValue={values?.heroImage ?? ''} error={f.heroImage} disabled={disabled} />
      <Field label="Descrição" name="description" error={f.description}>
        <textarea id="description" name="description" rows={4} defaultValue={values?.description} disabled={disabled} />
      </Field>
      <Field label="Destaques (um por linha)" name="highlights" error={f.highlights}>
        <textarea id="highlights" name="highlights" rows={4} defaultValue={(values?.highlights ?? []).join('\n')} disabled={disabled} />
      </Field>
      <CheckField name="active" label="Empreendimento ativo" defaultChecked={values?.active ?? true} disabled={disabled} />
      {canWrite ? <div><SubmitButton>{create ? 'Criar empreendimento' : 'Salvar alterações'}</SubmitButton></div> : null}
    </form>
  );
}
