import { readFileSync } from 'node:fs';
import { illustrativeParameters } from '@mvp/simulation';
import { z } from 'zod';
import type { Db } from './client';
import { dateFromIso } from './convert';
import { listParameterSets, publishParameters } from './parameters/repository';

// Seed idempotente do MVP: 1 empreendimento, unidades, 2 corretores (seed/catalog-ilustrativo.json)
// e a primeira versão de parâmetros (seed ILUSTRATIVO do motor). Rodar de novo não duplica nada
// e nunca altera parâmetros já publicados (alteração é só pela CLI, com auditoria).

const catalogSchema = z.object({
  status: z.literal('ILUSTRATIVO').or(z.literal('VALIDADO')),
  development: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1),
    description: z.string(),
    deliveryDate: z.string(),
    construction: z
      .object({ signalRatio: z.number().min(0).max(1), balloonRatio: z.number().min(0).max(1), balloonIntervalMonths: z.number().int().positive() })
      .nullable(),
    faq: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })),
    materials: z.array(z.object({ title: z.string().min(1), url: z.string().url() })),
  }),
  units: z.array(z.object({ code: z.string().min(1), typology: z.string().min(1), areaM2: z.number().positive(), price: z.number().positive() })).min(1),
  brokers: z
    .array(z.object({ name: z.string().min(1), phone: z.string().regex(/^\d{12,13}$/), email: z.string().email().nullable(), team: z.string().nullable() }))
    .min(1),
});

export type Catalog = z.infer<typeof catalogSchema>;

export function loadCatalog(path = new URL('../seed/catalog-ilustrativo.json', import.meta.url)): Catalog {
  return catalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export interface SeedSummary {
  parameters: 'created' | 'kept';
  parametersVersion: string;
  developmentId: string;
  units: number;
  brokers: number;
}

export type SeedParameters = { version: string; validFrom: string };

/** Publica os parâmetros do seed só se ainda não houver nenhuma versão (nunca altera as existentes). */
export async function ensureParameters(db: Db, params: SeedParameters, today: string): Promise<{ parameters: 'created' | 'kept'; parametersVersion: string }> {
  const existing = await listParameterSets(db);
  if (existing.length > 0) return { parameters: 'kept', parametersVersion: existing.at(-1)!.version };
  const published = await publishParameters(db, {
    params,
    version: params.version,
    validFrom: params.validFrom,
    actor: 'seed',
    reason: 'versão inicial (seed ILUSTRATIVO)',
    today,
    allowRetroactive: true,
    action: 'PARAMETERS_IMPORTED',
  });
  return { parameters: 'created', parametersVersion: published.created.version };
}

export async function seedDatabase(db: Db, opts: { today: string; catalog?: Catalog; parameters?: unknown }): Promise<SeedSummary> {
  const catalog = opts.catalog ?? loadCatalog();
  const params = (opts.parameters ?? illustrativeParameters) as SeedParameters;

  const { parameters, parametersVersion } = await ensureParameters(db, params, opts.today);

  const d = catalog.development;
  const devData = {
    name: d.name,
    city: d.city,
    description: d.description,
    deliveryDate: dateFromIso(d.deliveryDate),
    faq: d.faq,
    materials: d.materials,
    signalRatio: d.construction?.signalRatio ?? null,
    balloonRatio: d.construction?.balloonRatio ?? null,
    balloonIntervalMonths: d.construction?.balloonIntervalMonths ?? null,
    dataStatus: catalog.status,
  };
  const development = await db.development.upsert({ where: { slug: d.slug }, create: { slug: d.slug, ...devData }, update: devData });

  for (const u of catalog.units) {
    const data = { typology: u.typology, areaM2: u.areaM2, price: u.price };
    await db.unit.upsert({
      where: { developmentId_code: { developmentId: development.id, code: u.code } },
      create: { developmentId: development.id, code: u.code, ...data },
      update: data,
    });
  }
  for (const b of catalog.brokers) {
    const data = { name: b.name, email: b.email, team: b.team };
    await db.broker.upsert({ where: { phone: b.phone }, create: { phone: b.phone, ...data }, update: data });
  }

  return { parameters, parametersVersion, developmentId: development.id, units: catalog.units.length, brokers: catalog.brokers.length };
}
