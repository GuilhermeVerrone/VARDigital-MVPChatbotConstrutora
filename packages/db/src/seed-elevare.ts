import { readFileSync } from 'node:fs';
import { illustrativeParameters, illustrativeSalesConditions } from '@mvp/simulation';
import { z } from 'zod';
import type { Db } from './client';
import { dateFromIso } from './convert';
import { createUser } from './users';
import { ensureParameters, type SeedParameters } from './seed';
import { listSalesConditions, publishSalesCondition } from './sales-conditions/repository';

// Seed da V2: os 3 empreendimentos Elevare (Lumen Urban, Parc Verde, Altomare) com unidades e preços
// ILUSTRATIVO, a condição comercial vigente de cada um, corretores fictícios e 1 usuário admin de demo
// (seed/catalog-elevare.json). Idempotente: rodar de novo não duplica nada e nunca altera condições nem
// parâmetros já publicados (alteração é só por publicação versionada, com auditoria).

/** Senha do admin de demo quando DEMO_ADMIN_PASSWORD não está definida. Só para a demo/local. */
export const DEFAULT_DEMO_ADMIN_PASSWORD = 'elevare-demo-2026';

const slugs = Object.keys(illustrativeSalesConditions);

const developmentSchema = z.object({
  slug: z.string().refine((s) => slugs.includes(s), 'slug sem condição comercial no seed do motor'),
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  description: z.string().min(1),
  deliveryDate: z.string(),
  heroImage: z.string().min(1),
  highlights: z.array(z.string().min(1)),
  gallery: z.array(z.object({ url: z.string().min(1), alt: z.string().min(1) })),
  faq: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })),
  materials: z.array(z.object({ title: z.string().min(1), url: z.string().url() })),
  units: z.array(z.object({ code: z.string().min(1), typology: z.string().min(1), areaM2: z.number().positive(), price: z.number().positive() })).min(1),
});

const elevareCatalogSchema = z.object({
  status: z.enum(['ILUSTRATIVO', 'VALIDADO']),
  developments: z.array(developmentSchema).min(1),
  brokers: z
    .array(z.object({ name: z.string().min(1), phone: z.string().regex(/^\d{12,13}$/), email: z.string().email().nullable(), team: z.string().nullable() }))
    .min(1),
  adminUser: z.object({ name: z.string().min(1), email: z.string().email() }),
});

export type ElevareCatalog = z.infer<typeof elevareCatalogSchema>;

export function loadElevareCatalog(path = new URL('../seed/catalog-elevare.json', import.meta.url)): ElevareCatalog {
  return elevareCatalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export interface ElevareSeedSummary {
  parameters: 'created' | 'kept';
  parametersVersion: string;
  developments: number;
  units: number;
  salesConditions: number;
  brokers: number;
  adminUser: 'created' | 'kept';
}

export interface SeedElevareOptions {
  today: string;
  catalog?: ElevareCatalog;
  parameters?: unknown;
  /** Senha do admin de demo (padrão: DEMO_ADMIN_PASSWORD ou DEFAULT_DEMO_ADMIN_PASSWORD). */
  adminPassword?: string;
}

export async function seedElevare(db: Db, opts: SeedElevareOptions): Promise<ElevareSeedSummary> {
  const catalog = opts.catalog ?? loadElevareCatalog();
  const params = (opts.parameters ?? illustrativeParameters) as SeedParameters;
  const { parameters, parametersVersion } = await ensureParameters(db, params, opts.today);

  let units = 0;
  let salesConditions = 0;
  for (const d of catalog.developments) {
    const data = {
      name: d.name,
      city: d.city,
      address: d.address,
      description: d.description,
      deliveryDate: dateFromIso(d.deliveryDate),
      heroImage: d.heroImage,
      highlights: d.highlights,
      gallery: d.gallery,
      faq: d.faq,
      materials: d.materials,
      published: true,
      dataStatus: catalog.status,
    };
    const development = await db.development.upsert({ where: { slug: d.slug }, create: { slug: d.slug, ...data }, update: data });

    for (const u of d.units) {
      const unit = { typology: u.typology, areaM2: u.areaM2, price: u.price };
      await db.unit.upsert({
        where: { developmentId_code: { developmentId: development.id, code: u.code } },
        create: { developmentId: development.id, code: u.code, ...unit },
        update: unit,
      });
      units += 1;
    }

    // Condição comercial: só publica se o empreendimento ainda não tem nenhuma versão.
    if ((await listSalesConditions(db, development.id)).length === 0) {
      const condition = illustrativeSalesConditions[d.slug as keyof typeof illustrativeSalesConditions];
      await publishSalesCondition(db, {
        developmentId: development.id,
        condition,
        version: condition.version,
        validFrom: condition.validFrom,
        actor: 'seed',
        reason: 'versão inicial (seed ILUSTRATIVO)',
        today: opts.today,
        allowRetroactive: true,
        action: 'SALES_CONDITION_IMPORTED',
      });
      salesConditions += 1;
    }
  }

  for (const b of catalog.brokers) {
    const data = { name: b.name, email: b.email, team: b.team };
    await db.broker.upsert({ where: { phone: b.phone }, create: { phone: b.phone, ...data }, update: data });
  }

  const email = catalog.adminUser.email.toLowerCase();
  let adminUser: ElevareSeedSummary['adminUser'] = 'kept';
  if (!(await db.user.findUnique({ where: { email } }))) {
    const password = opts.adminPassword ?? process.env.DEMO_ADMIN_PASSWORD ?? DEFAULT_DEMO_ADMIN_PASSWORD;
    await createUser(db, { name: catalog.adminUser.name, email, password, role: 'ADMIN' });
    adminUser = 'created';
  }

  return {
    parameters,
    parametersVersion,
    developments: catalog.developments.length,
    units,
    salesConditions,
    brokers: catalog.brokers.length,
    adminUser,
  };
}
