'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FlowFormValues } from '@/lib/flow-form';
import type { FormState } from '@/lib/form-state';
import { discardFlowAction, publishFlowAction, revertFlowAction, saveFlowAction } from './actions';

export interface TextItem { key: string; label: string; group: string; fallback: string; variables: string[] }
export interface StepItem { key: string; label: string; hint: string }

interface Props {
  values: FlowFormValues;
  texts: TextItem[];
  steps: StepItem[];
  firstContact: { fallback: string; variables: string[] };
  /** Problemas do rascunho já salvo (ao abrir a tela). */
  savedErrors: Record<string, string>;
  canWrite: boolean;
}

function Message({ error, warning }: { error?: string | undefined; warning?: string | undefined }) {
  if (error) return <span className="error" role="alert">{error}</span>;
  if (warning) return <span className="warn-text" role="status">{warning}</span>;
  return null;
}

export function FlowEditor({ values, texts, steps, firstContact, savedErrors, canWrite }: Props) {
  const [state, dispatch] = useActionState<FormState, FormData>(saveFlowAction, {});
  const errors = state.fields ?? (state.ok ? {} : savedErrors);
  const warnings = state.warnings ?? {};
  const groups = [...new Set(texts.map((t) => t.group))];
  const vars = (v: string[]) => (v.length > 0 ? `Variáveis: ${v.map((x) => `{${x}}`).join(' ')}` : 'Sem variáveis');
  return (
    <form action={dispatch} aria-label="Editor do fluxo">
      {state.ok ? <Notice kind="ok">{state.ok}</Notice> : null}
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}

      <fieldset>
        <legend>1ª mensagem (após o formulário do site)</legend>
        <div className="field">
          <label htmlFor="firstContact">Mensagem enviada a quem preencheu o formulário</label>
          <textarea id="firstContact" name="firstContact" rows={3} defaultValue={values.firstContact} placeholder={firstContact.fallback} disabled={!canWrite} aria-invalid={errors.firstContact ? true : undefined} aria-describedby="firstContact-hint" />
          <span className="hint" id="firstContact-hint">{vars(firstContact.variables)}. Vazio = texto padrão.</span>
          <Message error={errors.firstContact} warning={warnings.firstContact} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Etapas opcionais</legend>
        <p className="hint">Desligar uma etapa pula a pergunta; o bot segue sem ela.</p>
        {steps.map((s) => (
          <div className="field" key={s.key}>
            <label htmlFor={`step.${s.key}`}>{s.label}</label>
            <select id={`step.${s.key}`} name={`step.${s.key}`} defaultValue={values[`step.${s.key}`]} disabled={!canWrite}>
              <option value="on">Ligada</option>
              <option value="off">Desligada</option>
            </select>
            <span className="hint">{s.hint}</span>
            <Message error={errors[`step.${s.key}`]} />
          </div>
        ))}
      </fieldset>

      {groups.map((g) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {texts.filter((t) => t.group === g).map((t) => {
            const name = `text.${t.key}`;
            return (
              <div className="field" key={t.key}>
                <label htmlFor={name}>{t.label}</label>
                <textarea id={name} name={name} rows={3} defaultValue={values[name]} placeholder={t.fallback} disabled={!canWrite} aria-invalid={errors[name] ? true : undefined} aria-describedby={`${name}-hint`} />
                <span className="hint" id={`${name}-hint`}>{vars(t.variables)}. Vazio = texto padrão.</span>
                <Message error={errors[name]} warning={warnings[name]} />
                <details>
                  <summary>Botões desta etapa</summary>
                  <textarea name={`buttons.${t.key}`} rows={2} defaultValue={values[`buttons.${t.key}`]} disabled={!canWrite} aria-label={`Botões de ${t.label}`} />
                  <span className="hint">Um por linha, até 3, com até 25 caracteres. O WhatsApp do piloto mostra lista numerada (decisão da Fase 9), então os botões ficam guardados para quando o canal os suportar.</span>
                  <Message error={errors[`buttons.${t.key}`]} />
                </details>
              </div>
            );
          })}
        </fieldset>
      ))}
      {canWrite ? <div className="inline-form"><SubmitButton pendingLabel="Salvando…">Salvar rascunho</SubmitButton></div> : null}
    </form>
  );
}

export function DiscardDraft() {
  const [state, dispatch] = useActionState<FormState>(discardFlowAction, {});
  return (
    <form action={dispatch} className="inline-form">
      <SubmitButton variant="ghost" pendingLabel="Descartando…">Descartar rascunho</SubmitButton>
      {state.ok ? <span className="ok-text" role="status">{state.ok}</span> : null}
      {state.error ? <span className="error" role="alert">{state.error}</span> : null}
    </form>
  );
}

export function ReasonForm({ kind, blocked, label }: { kind: 'publish' | 'revert'; blocked?: boolean; label: string }) {
  const [state, dispatch] = useActionState<FormState, FormData>(kind === 'publish' ? publishFlowAction : revertFlowAction, {});
  return (
    <form action={dispatch} className="stack">
      <div className="field">
        <label htmlFor={`reason-${kind}`}>Motivo</label>
        <input id={`reason-${kind}`} name="reason" autoComplete="off" disabled={blocked} aria-invalid={state.fields?.reason ? true : undefined} />
        {state.fields?.reason ? <span className="error" role="alert">{state.fields.reason}</span> : null}
      </div>
      <div className="inline-form"><SubmitButton variant={kind === 'publish' ? 'primary' : 'ghost'} disabled={blocked} pendingLabel="Enviando…">{label}</SubmitButton></div>
      {state.ok ? <Notice kind="ok">{state.ok}</Notice> : null}
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
    </form>
  );
}
