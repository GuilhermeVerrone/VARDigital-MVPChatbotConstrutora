'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PanelNotFoundError } from '@mvp/db/panel';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { leadsService } from '@/lib/services';

const notFound = { error: 'Lead não encontrado.' } satisfies FormState;

async function run(leadId: string, fn: (ctx: Awaited<ReturnType<typeof requireAction>>['ctx']) => Promise<FormState>): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    const state = await fn(ctx);
    revalidatePath(`/leads/${leadId}`);
    revalidatePath('/leads');
    return state;
  } catch (err) {
    if (err instanceof PanelNotFoundError) return notFound;
    return toFormState(err);
  }
}

export async function assignBrokerAction(leadId: string, _prev: FormState, form: FormData): Promise<FormState> {
  return run(leadId, async (ctx) => {
    const brokerId = String(form.get('brokerId') ?? '');
    const r = await leadsService.assign(ctx, leadId, brokerId || null);
    return { ok: r.changed ? (brokerId ? 'Corretor atribuído.' : 'Corretor removido.') : 'O lead já estava com este corretor.' };
  });
}

const HANDOFF_ERROR = {
  no_handoff: 'Este lead não está em handoff.',
  taken_by_other: 'Outro corretor já assumiu esta conversa.',
  not_taken: 'Ninguém assumiu esta conversa ainda.',
} as const;

export async function takeHandoffAction(leadId: string, _prev: FormState): Promise<FormState> {
  return run(leadId, async (ctx) => {
    const r = await leadsService.takeHandoff(ctx, leadId);
    if (!r.ok) return { error: HANDOFF_ERROR[r.reason] };
    return { ok: r.alreadyYours ? 'A conversa já era sua.' : 'Você assumiu a conversa. O bot continua calado.' };
  });
}

export async function releaseHandoffAction(leadId: string, _prev: FormState): Promise<FormState> {
  return run(leadId, async (ctx) => {
    const r = await leadsService.releaseHandoff(ctx, leadId);
    if (!r.ok) return { error: HANDOFF_ERROR[r.reason] };
    return { ok: 'Conversa devolvida ao bot. Ele retoma a pergunta em que o lead estava.' };
  });
}

export async function eraseLeadAction(leadId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    await leadsService.requestErasure(ctx, leadId, String(form.get('confirmation') ?? ''));
  } catch (err) {
    if (err instanceof PanelNotFoundError) return notFound;
    return toFormState(err);
  }
  revalidatePath('/leads');
  redirect('/leads?apagado=1');
}
