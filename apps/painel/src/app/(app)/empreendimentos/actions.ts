'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { requireAction, toFormState } from '@/lib/server';
import { developmentsService } from '@/lib/services';

function developmentData(form: FormData) {
  return {
    name: String(form.get('name') ?? ''),
    city: String(form.get('city') ?? ''),
    address: String(form.get('address') ?? ''),
    description: String(form.get('description') ?? ''),
    deliveryDate: String(form.get('deliveryDate') ?? ''),
    heroImage: String(form.get('heroImage') ?? ''),
    highlights: String(form.get('highlights') ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
    active: form.get('active') === 'on',
  };
}

export async function createDevelopmentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  let id: string;
  try {
    id = (await developmentsService.create(ctx, { ...developmentData(form), slug: String(form.get('slug') ?? '') })).id;
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath('/empreendimentos');
  redirect(`/empreendimentos/${id}`);
}

export async function updateDevelopmentAction(id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    await developmentsService.update(ctx, id, developmentData(form));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/empreendimentos/${id}`);
  revalidatePath('/empreendimentos');
  return { ok: 'Empreendimento salvo.' };
}

export async function setPublishedAction(id: string, published: boolean, _prev: FormState): Promise<FormState> {
  const { ctx } = await requireAction();
  try {
    await developmentsService.setPublished(ctx, id, published);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/empreendimentos/${id}`);
  revalidatePath('/empreendimentos');
  return { ok: published ? 'Publicado no site.' : 'Removido do site.' };
}

export async function saveUnitAction(developmentId: string, unitId: string | undefined, _prev: FormState, form: FormData): Promise<FormState> {
  const { ctx } = await requireAction();
  const num = (k: string) => {
    const raw = String(form.get(k) ?? '').trim().replace(',', '.');
    return raw === '' ? undefined : Number(raw);
  };
  try {
    await developmentsService.saveUnit(ctx, developmentId, unitId, {
      code: String(form.get('code') ?? ''),
      typology: String(form.get('typology') ?? ''),
      areaM2: num('areaM2'),
      price: num('price'),
      status: String(form.get('status') ?? 'AVAILABLE'),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/empreendimentos/${developmentId}`);
  revalidatePath('/empreendimentos');
  return { ok: unitId ? 'Unidade salva.' : 'Unidade criada.' };
}
