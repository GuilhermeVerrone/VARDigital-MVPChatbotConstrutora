'use server';

import { revalidatePath } from 'next/cache';
import { flowErrors } from '@mvp/conversation';
import type { FlowFormValues } from '@/lib/flow-form';
import { issuesByField } from '@/lib/flow-form';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { flowService } from '@/lib/services';

const FIELD = /^(text\.|step\.|buttons\.|firstContact$)/;

function valuesOf(form: FormData): FlowFormValues {
  const out: FlowFormValues = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string' && FIELD.test(k)) out[k] = v;
  return out;
}

export async function saveFlowAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    const { issues } = await flowService.saveDraft(ctx, valuesOf(form));
    revalidatePath('/fluxo');
    const errors = flowErrors(issues);
    const warnings = issuesByField(issues.filter((i) => i.severity === 'warning'));
    if (errors.length > 0) {
      return { error: `Rascunho salvo, mas com ${errors.length} problema${errors.length > 1 ? 's' : ''}: não dá para publicar até corrigir.`, fields: issuesByField(errors), warnings };
    }
    return { ok: 'Rascunho salvo. Ainda não foi ao ar: publique abaixo.', warnings };
  } catch (err) {
    return toFormState(err);
  }
}

export async function discardFlowAction(_prev: FormState): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    await flowService.discardDraft(ctx);
    revalidatePath('/fluxo');
    return { ok: 'Rascunho descartado.' };
  } catch (err) {
    return toFormState(err);
  }
}

export async function publishFlowAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    const v = await flowService.publish(ctx, String(form.get('reason') ?? ''));
    revalidatePath('/fluxo');
    return { ok: `Versão ${v.version} publicada. O bot passa a usar os novos textos na próxima mensagem (até 1 minuto).` };
  } catch (err) {
    return toFormState(err);
  }
}

export async function revertFlowAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    const v = await flowService.revert(ctx, String(form.get('reason') ?? ''));
    revalidatePath('/fluxo');
    return { ok: `Revertido: a versão ${v.version} tem o conteúdo da anterior.` };
  } catch (err) {
    return toFormState(err);
  }
}
