'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, signOut } from '@/lib/auth';
import { getDb, getUser } from '@/lib/server';

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const user = await getUser();
  await signOut(getDb(), jar.get(SESSION_COOKIE)?.value, user?.id);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
