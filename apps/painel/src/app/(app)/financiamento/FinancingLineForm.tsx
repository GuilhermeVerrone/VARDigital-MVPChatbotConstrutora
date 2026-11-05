'use client';

import { useActionState } from 'react';
import { CheckField, Field, Notice, SelectField, TextField } from '@/components/fields';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { publishFinancingAction } from './actions';

export interface LineValues {
  id: string;
  name: string;
  annualInterestRate: number;
  termMin: number;
  termMax: number;
  systems: ('SAC' | 'PRICE')[];
  maxIncomeCommitment: number;
}

const pct = (r: number) => String(Number((r * 100).toFixed(4)));

export function FinancingLineForm({ line, defaultSystem, today, canWrite }: { line: LineValues; defaultSystem: 'SAC' | 'PRICE'; today: string; canWrite: boolean }) {
  const [state, dispatch] = useActionState<FormState, FormData>(publishFinancingAction.bind(null, line.id), {});
  const f = state.fields ?? {};
  const key = line.id;
  return (
    <form action={dispatch} className="card line">
      <h3>{line.name}</h3>
      {state.ok ? <Notice kind="ok">{state.ok}</Notice> : null}
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      <fieldset disabled={!canWrite}>
        <div className="form-grid">
          <TextField name="annualInterestRate" label="Taxa de juros (% ao ano)" defaultValue={pct(line.annualInterestRate)} error={f.annualInterestRate} inputMode="decimal" />
          <TextField name="maxIncomeCommitment" label="Comprometimento máximo da renda (%)" defaultValue={pct(line.maxIncomeCommitment)} error={f.maxIncomeCommitment} inputMode="decimal" />
          <TextField name="termMin" label="Prazo mínimo (meses)" defaultValue={line.termMin} error={f.termMin} inputMode="numeric" />
          <TextField name="termMax" label="Prazo máximo (meses)" defaultValue={line.termMax} error={f.termMax} inputMode="numeric" />
          <div className="field">
            <span className="legend">Sistemas de amortização</span>
            <CheckField name="systems" value="SAC" label="SAC" defaultChecked={line.systems.includes('SAC')} />
            <CheckField name="systems" value="PRICE" label="Price" defaultChecked={line.systems.includes('PRICE')} />
            {f.systems ? <span className="error" role="alert">{f.systems}</span> : null}
          </div>
          <SelectField name="defaultSystem" label="Sistema padrão (vale para todas as linhas)" defaultValue={defaultSystem} error={f.defaultSystem} options={[{ value: 'SAC', label: 'SAC' }, { value: 'PRICE', label: 'Price' }]} />
          <TextField name="validFrom" label="Vale a partir de" type="date" defaultValue={today} error={f.validFrom} />
          <Field label="Motivo da alteração" name={`reason-${key}`} error={f.reason}>
            <textarea id={`reason-${key}`} name="reason" rows={2} />
          </Field>
        </div>
        {canWrite ? <SubmitButton pendingLabel="Publicando…">Publicar nova versão</SubmitButton> : null}
      </fieldset>
    </form>
  );
}
