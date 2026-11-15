'use server';

import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { usersService } from '@/lib/services';

/** Com erro, devolve o que foi enviado (menos a senha): o React limpa o formulário ao fim da ação. */
export type UserFormState = FormState & { sent?: Record<string, string> };

export async function saveUserAction(userId: string | undefined, _prev: UserFormState, form: FormData): Promise<UserFormState> {
  const { ctx } = await requireAction();
  const sent = {
    name: String(form.get('name') ?? ''),
    email: String(form.get('email') ?? ''),
    role: String(form.get('role') ?? ''),
    brokerId: String(form.get('brokerId') ?? ''),
    active: form.get('active') === 'on' ? 'on' : '',
  };
  const password = String(form.get('password') ?? '');
  try {
    await usersService.save(ctx, userId, { ...sent, active: sent.active === 'on', password });
  } catch (err) {
    return { ...toFormState(err), sent };
  }
  revalidatePath('/usuarios');
  if (!userId) return { ok: 'Usuário criado. Passe a senha inicial por um canal seguro.' };
  return { ok: password ? 'Senha redefinida. As sessões do usuário foram encerradas.' : 'Usuário salvo.' };
}
