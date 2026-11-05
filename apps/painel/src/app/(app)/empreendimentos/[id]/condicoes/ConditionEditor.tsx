'use client';

import { useActionState } from 'react';
import { CheckField, Field, Notice, SelectField, TextField } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import { CONDITION_GROUPS } from '@/lib/condition-form';
import { brl } from '@/lib/format';
import { publishConditionAction, previewConditionAction, type ConditionState } from './actions';
import { ChangesTable, PreviewView } from './PreviewView';

interface Props {
  developmentId: string;
  values: Record<string, string>;
  units: { id: string; label: string; price: number }[];
  profiles: { id: string; label: string }[];
  today: string;
  canWrite: boolean;
  /** Versão vigente exibida como base do rascunho; null = empreendimento sem condição. */
  baseVersion: string | null;
}

/** Rascunho = o próprio formulário (parte da vigente): "Calcular prévia" mostra o diff e o plano; "Publicar" grava a versão. */
export function ConditionEditor({ developmentId, values, units, profiles, today, canWrite, baseVersion }: Props) {
  const [pv, previewDispatch] = useActionState<ConditionState, FormData>(previewConditionAction.bind(null, developmentId), {});
  const [pb, publishDispatch] = useActionState<ConditionState, FormData>(publishConditionAction.bind(null, developmentId), {});
  const errors = { ...pv.fields, ...pb.fields };
  return (
    <form className="editor">
      <div className="editor-form">
        <p className="muted">{baseVersion ? <>Rascunho a partir da versão vigente <strong>{baseVersion}</strong>. Nada vale até publicar.</> : 'Este empreendimento ainda não tem condição comercial. Preencha todos os campos.'}</p>
        {CONDITION_GROUPS.map((g) => (
          <fieldset key={g.id} disabled={!canWrite}>
            <legend>{g.title}</legend>
            <div className="form-grid">
              {g.fields.map((f) =>
                f.kind === 'bool' ? (
                  <CheckField key={f.name} name={f.name} label={f.label} defaultChecked={values[f.name] === 'on'} />
                ) : f.kind === 'select' ? (
                  <SelectField key={f.name} name={f.name} label={f.label} hint={f.hint} defaultValue={values[f.name]} error={errors[f.name]} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
                ) : (
                  <TextField key={f.name} name={f.name} label={f.label} hint={f.hint} defaultValue={values[f.name]} error={errors[f.name]} inputMode="decimal" />
                ),
              )}
            </div>
          </fieldset>
        ))}
        {canWrite ? (
          <fieldset>
            <legend>Publicar</legend>
            <div className="form-grid">
              <TextField name="validFrom" label="Vale a partir de" type="date" defaultValue={today} error={errors.validFrom} hint="Não pode ser anterior a hoje. A versão vigente passa a terminar na véspera." />
              <Field label="Motivo da alteração" name="reason" error={errors.reason} hint="Fica na auditoria, junto com o seu usuário.">
                <textarea id="reason" name="reason" rows={2} />
              </Field>
            </div>
            {pb.ok ? <Notice kind="ok">{pb.ok}</Notice> : null}
            {pb.error ? <Notice kind="error">{pb.error}</Notice> : null}
            {pb.ok && pb.changes ? <ChangesTable changes={pb.changes} /> : null}
            <SubmitButton formAction={publishDispatch} pendingLabel="Publicando…">Publicar nova versão</SubmitButton>
          </fieldset>
        ) : null}
      </div>

      <aside className="editor-preview" aria-label="Calculadora de prévia">
        <h2>Prévia</h2>
        <p className="muted small">Escolha a unidade e um perfil de exemplo. O cálculo usa o motor real, com os valores do formulário (mesmo que ainda não publicados).</p>
        <SelectField name="unitId" label="Unidade" options={units.map((u) => ({ value: u.id, label: `${u.label} · ${brl(u.price, 0)}` }))} />
        <SelectField name="profileId" label="Perfil de exemplo" options={profiles.map((p) => ({ value: p.id, label: p.label }))} />
        <SubmitButton formAction={previewDispatch} variant="ghost" pendingLabel="Calculando…">Calcular prévia</SubmitButton>
        {pv.error ? <Notice kind="error">{pv.error}</Notice> : null}
        {pv.preview ? <PreviewView preview={pv.preview} changes={pv.changes} current={pv.current} /> : <p className="muted small">A prévia aparece aqui, com o que muda em relação à vigente.</p>}
      </aside>
    </form>
  );
}
