'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { changePassword, SESSION_COOKIE } from '@/lib/auth';
import type { FormState } from '@/lib/form-state';
import { requireAction } from '@/lib/server';

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, ctx } = await requireAction();
  const res = await changePassword(ctx.db, {
    user,
    current: String(form.get('current') ?? ''),
    next: String(form.get('next') ?? ''),
    confirm: String(form.get('confirm') ?? ''),
    token: (await cookies()).get(SESSION_COOKIE)?.value,
  });
  if (!res.ok) return { fields: res.fields, error: 'Corrija os campos destacados.' };
  // O aviso de senha provisória some do layout.
  revalidatePath('/', 'layout');
  return { ok: 'Senha trocada. Os outros acessos abertos com a senha antiga foram encerrados.' };
}
