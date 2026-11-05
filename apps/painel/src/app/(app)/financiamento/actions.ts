'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { financingService } from '@/lib/services';

const toNumber = (v: FormDataEntryValue | null): number | undefined => {
  const raw = String(v ?? '').trim().replace(',', '.');
  return raw === '' || !Number.isFinite(Number(raw)) ? undefined : Number(raw);
};
const toRatio = (v: FormDataEntryValue | null): number | undefined => {
  const n = toNumber(v);
  return n === undefined ? undefined : Number((n / 100).toFixed(8));
};

export async function publishFinancingAction(lineId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    const res = await financingService.publishLine(ctx, {
      lineId,
      annualInterestRate: toRatio(form.get('annualInterestRate')),
      termMin: toNumber(form.get('termMin')),
      termMax: toNumber(form.get('termMax')),
      systems: form.getAll('systems').map(String),
      defaultSystem: String(form.get('defaultSystem') ?? ''),
      maxIncomeCommitment: toRatio(form.get('maxIncomeCommitment')),
      validFrom: String(form.get('validFrom') ?? ''),
      reason: String(form.get('reason') ?? ''),
    });
    revalidatePath('/financiamento');
    return { ok: `Nova versão ${res.created.version} publicada.` };
  } catch (err) {
    return toFormState(err);
  }
}
