'use server';

import { revalidatePath } from 'next/cache';
import { todayIso, type ParameterChange } from '@mvp/db/panel';
import { valuesFromFormData } from '@/lib/condition-form';
import { requireAction, toFormState } from '@/lib/server';
import { checkConditionDraft, previewConditionService, publishConditionDraft, type PreviewOutput } from '@/lib/services';

export interface ConditionState {
  ok?: string;
  error?: string;
  fields?: Record<string, string>;
  preview?: PreviewOutput;
  changes?: ParameterChange[];
  current?: { version: string; validFrom: string } | null;
}

function read(form: FormData) {
  return {
    values: valuesFromFormData(form),
    validFrom: String(form.get('validFrom') ?? ''),
    reason: String(form.get('reason') ?? ''),
    unitId: String(form.get('unitId') ?? ''),
    profileId: String(form.get('profileId') ?? ''),
  };
}

/** Valida o rascunho, mostra o que muda e calcula a prévia dos modos com o motor real. Não grava. */
export async function previewConditionAction(developmentId: string, _prev: ConditionState, form: FormData): Promise<ConditionState> {
  const { ctx } = await requireAction();
  const f = read(form);
  try {
    const check = await checkConditionDraft(ctx, { developmentId, values: f.values, validFrom: f.validFrom });
    if (!check.condition) return { fields: check.errors, error: 'Corrija os campos destacados para calcular a prévia.' };
    const preview = await previewConditionService(ctx, { developmentId, unitId: f.unitId, profileId: f.profileId, values: f.values, referenceDate: todayIso() });
    return { preview, changes: check.changes, current: check.current };
  } catch (err) {
    return toFormState(err);
  }
}

/** Publica o rascunho como nova versão (imutável), com vigência e motivo. */
export async function publishConditionAction(developmentId: string, _prev: ConditionState, form: FormData): Promise<ConditionState> {
  const { ctx } = await requireAction();
  const f = read(form);
  try {
    const res = await publishConditionDraft(ctx, { developmentId, values: f.values, validFrom: f.validFrom, reason: f.reason });
    revalidatePath(`/empreendimentos/${developmentId}/condicoes`);
    revalidatePath('/');
    return { ok: `Versão ${res.created.version} publicada, valendo desde ${f.validFrom.split('-').reverse().join('/')}.`, changes: res.changes };
  } catch (err) {
    return toFormState(err);
  }
}
