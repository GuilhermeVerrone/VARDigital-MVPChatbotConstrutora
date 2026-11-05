'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { handleSubmission, type SubmitOutcome } from '@/lib/submit';
import { clientIp, formSecret, getDb, limiters } from '@/lib/server';

export type FormState = Exclude<SubmitOutcome, { status: 'ok' } | { status: 'ignored' }> | { status: 'idle' };

/** Server Action do "Simule sua condição": valida no servidor e leva à página de obrigado. */
export async function simulate(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = clientIp(await headers());
  const outcome = await handleSubmission(
    { db: getDb(), formSecret: formSecret(), ipLimiter: limiters.ip, phoneLimiter: limiters.phone },
    Object.fromEntries(formData),
    ip,
  );
  if (outcome.status === 'ok') redirect(`/obrigado?c=${encodeURIComponent(outcome.contactCode)}&e=${encodeURIComponent(outcome.development)}`);
  // Robô do honeypot: segue como sucesso, sem código (a página de obrigado não oferece nada).
  if (outcome.status === 'ignored') redirect(`/obrigado?e=${encodeURIComponent(outcome.development)}`);
  return outcome;
}
