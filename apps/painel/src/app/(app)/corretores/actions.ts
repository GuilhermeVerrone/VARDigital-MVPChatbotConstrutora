'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { brokersService } from '@/lib/services';

export async function saveBrokerAction(brokerId: string | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    await brokersService.save(ctx, brokerId, {
      name: String(form.get('name') ?? ''),
      phone: String(form.get('phone') ?? ''),
      email: String(form.get('email') ?? ''),
      team: String(form.get('team') ?? ''),
      active: form.get('active') === 'on',
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/corretores');
  return { ok: brokerId ? 'Corretor salvo.' : 'Corretor criado.' };
}
