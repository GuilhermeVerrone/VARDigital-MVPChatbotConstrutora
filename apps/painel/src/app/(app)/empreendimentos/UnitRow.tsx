'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import type { FormState } from '@/lib/form-state';
import { UNIT_STATUS_LABEL } from '@/lib/format';
import { saveUnitAction } from './actions';

export interface UnitValues { id?: string; code: string; typology: string; areaM2: number; price: number; status: 'AVAILABLE' | 'RESERVED' | 'SOLD' }

/** Uma unidade por linha, cada uma com o seu formulário (a linha vazia cria). */
export function UnitRow({ developmentId, unit, canWrite }: { developmentId: string; unit?: UnitValues; canWrite: boolean }) {
  const [state, dispatch] = useActionState<FormState, FormData>(saveUnitAction.bind(null, developmentId, unit?.id), {});
  const f = state.fields ?? {};
  const key = unit?.id ?? 'new';
  const err = (k: string) => (f[k] ? <span className="error" role="alert">{f[k]}</span> : null);
  return (
    <form action={dispatch} className="unit-row" aria-label={unit ? `Unidade ${unit.code}` : 'Nova unidade'}>
      <div><label className="sr" htmlFor={`code-${key}`}>Código</label><input id={`code-${key}`} name="code" defaultValue={unit?.code} placeholder="Código" disabled={!canWrite} />{err('code')}</div>
      <div><label className="sr" htmlFor={`typ-${key}`}>Tipologia</label><input id={`typ-${key}`} name="typology" defaultValue={unit?.typology} placeholder="Tipologia" disabled={!canWrite} />{err('typology')}</div>
      <div><label className="sr" htmlFor={`area-${key}`}>Área (m²)</label><input id={`area-${key}`} name="areaM2" inputMode="decimal" defaultValue={unit?.areaM2} placeholder="m²" disabled={!canWrite} />{err('areaM2')}</div>
      <div><label className="sr" htmlFor={`price-${key}`}>Preço (R$)</label><input id={`price-${key}`} name="price" inputMode="decimal" defaultValue={unit?.price} placeholder="Preço" disabled={!canWrite} />{err('price')}</div>
      <div>
        <label className="sr" htmlFor={`st-${key}`}>Status</label>
        <select id={`st-${key}`} name="status" defaultValue={unit?.status ?? 'AVAILABLE'} disabled={!canWrite}>
          {Object.entries(UNIT_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="unit-actions">
        {canWrite ? <SubmitButton variant={unit ? 'ghost' : 'primary'}>{unit ? 'Salvar' : 'Adicionar'}</SubmitButton> : null}
        {state.ok ? <span className="ok-text" role="status">{state.ok}</span> : null}
        {state.error && !state.fields ? <span className="error" role="alert">{state.error}</span> : null}
      </div>
    </form>
  );
}
