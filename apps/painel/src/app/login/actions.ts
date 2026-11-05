'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, signIn } from '@/lib/auth';
import type { FormState } from '@/lib/form-state';
import { clientIp, getDb, secureCookies } from '@/lib/server';

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  if (!email.trim() || !password) return { error: 'Informe e-mail e senha.' };
  const userAgent = (await headers()).get('user-agent') ?? undefined;
  const res = await signIn(getDb(), { email, password, ip: await clientIp(), ...(userAgent ? { userAgent } : {}) });
  if (!res.ok) return { error: res.message };
  (await cookies()).set(SESSION_COOKIE, res.token, { httpOnly: true, sameSite: 'lax', secure: secureCookies(), path: '/', expires: res.expiresAt });
  redirect('/');
}
