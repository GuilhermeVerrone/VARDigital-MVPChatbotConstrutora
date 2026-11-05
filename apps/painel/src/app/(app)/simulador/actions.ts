'use server';

import { PanelValidationError } from '@mvp/db/panel';
import { ForbiddenError } from '@/lib/permissions';
import { requireAction } from '@/lib/server';
import { simulatorSend, simulatorStart, type SimEntry, type SimSource, type SimTurn } from '@/lib/simulator';

export type SimResult = { turn: SimTurn; error?: undefined } | { turn?: undefined; error: string };

const source = (v: unknown): SimSource => (v === 'published' ? 'published' : 'draft');

async function guard(fn: () => Promise<SimTurn>): Promise<SimResult> {
  try {
    return { turn: await fn() };
  } catch (err) {
    if (err instanceof PanelValidationError) return { error: Object.values(err.fields)[0] ?? 'Entrada inválida.' };
    if (err instanceof ForbiddenError) return { error: 'Você não tem permissão para esta ação.' };
    throw err;
  }
}

export async function startSimulatorAction(input: { source: string; entry: string; developmentId: string }): Promise<SimResult> {
  const { ctx } = await requireAction();
  return guard(() => simulatorStart(ctx, { source: source(input.source), entry: (input.entry === 'FORM' ? 'FORM' : 'WHATSAPP') satisfies SimEntry, ...(input.developmentId ? { developmentId: input.developmentId } : {}) }));
}

export async function sendSimulatorAction(input: { source: string; snapshot: unknown; text: string }): Promise<SimResult> {
  const { ctx } = await requireAction();
  return guard(() => simulatorSend(ctx, { source: source(input.source), snapshot: input.snapshot, text: String(input.text ?? '') }));
}
