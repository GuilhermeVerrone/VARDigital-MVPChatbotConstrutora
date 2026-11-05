import { z } from 'zod';
import type { Db } from '../client';
import { dateFromIso, isoFromDate, num } from '../convert';
import type { UnitStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { changedFields, recordAudit } from './audit';
import { PanelNotFoundError, PanelValidationError, requireActor } from './errors';

// Empreendimentos e unidades no painel (Fase 14). Toda alteração grava auditoria com o usuário.

export const DEVELOPMENT_ENTITY = 'Development';
export const UNIT_ENTITY = 'Unit';

const text = (label: string) => z.string().trim().min(1, `${label} é obrigatório`);

export const developmentFormSchema = z.object({
  name: text('Nome'),
  city: text('Cidade'),
  address: z.string().trim().transform((v) => v || null),
  description: text('Descrição'),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data AAAA-MM-DD'),
  heroImage: z.string().trim().transform((v) => v || null),
  /** Um destaque por linha. */
  highlights: z.array(z.string().trim().min(1)),
  active: z.boolean(),
});
export type DevelopmentForm = z.infer<typeof developmentFormSchema>;

export const newDevelopmentSchema = developmentFormSchema.extend({
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífen'),
});

export const unitFormSchema = z.object({
  code: text('Código'),
  typology: text('Tipologia'),
  areaM2: z.number({ error: 'Informe a metragem' }).positive('A metragem deve ser maior que zero').max(99999),
  price: z.number({ error: 'Informe o preço' }).positive('O preço deve ser maior que zero').max(999_999_999),
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD']),
});
export type UnitForm = z.infer<typeof unitFormSchema>;

function fail(error: z.ZodError): never {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[String(issue.path[0] ?? '_')] ??= issue.message;
  throw new PanelValidationError(fields);
}

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) fail(r.error);
  return r.data;
}

function validDate(iso: string): Date {
  try {
    return dateFromIso(iso);
  } catch {
    throw new PanelValidationError({ deliveryDate: 'Data inválida' });
  }
}

export interface AdminDevelopment {
  id: string;
  slug: string;
  name: string;
  city: string;
  published: boolean;
  active: boolean;
  deliveryDate: string;
  dataStatus: string;
  units: { total: number; available: number; reserved: number; sold: number };
  minPrice: number | null;
}

export async function listAdminDevelopments(db: Db): Promise<AdminDevelopment[]> {
  const rows = await db.development.findMany({ orderBy: { name: 'asc' }, include: { units: { select: { status: true, price: true } } } });
  return rows.map((d) => {
    const count = (s: UnitStatus) => d.units.filter((u) => u.status === s).length;
    const available = d.units.filter((u) => u.status === 'AVAILABLE').map((u) => num(u.price));
    return {
      id: d.id, slug: d.slug, name: d.name, city: d.city, published: d.published, active: d.active,
      deliveryDate: isoFromDate(d.deliveryDate), dataStatus: d.dataStatus,
      units: { total: d.units.length, available: count('AVAILABLE'), reserved: count('RESERVED'), sold: count('SOLD') },
      minPrice: available.length ? Math.min(...available) : null,
    };
  });
}

export interface AdminUnit { id: string; code: string; typology: string; areaM2: number; price: number; status: UnitStatus }

export async function getAdminDevelopment(db: Db, id: string) {
  const d = await db.development.findUnique({ where: { id }, include: { units: { orderBy: { code: 'asc' } } } });
  if (!d) throw new PanelNotFoundError('empreendimento');
  return {
    id: d.id, slug: d.slug, name: d.name, city: d.city, address: d.address, description: d.description,
    deliveryDate: isoFromDate(d.deliveryDate), heroImage: d.heroImage, highlights: d.highlights as string[],
    published: d.published, active: d.active, dataStatus: d.dataStatus,
    units: d.units.map<AdminUnit>((u) => ({ id: u.id, code: u.code, typology: u.typology, areaM2: num(u.areaM2), price: num(u.price), status: u.status })),
  };
}

function developmentSnapshot(d: { name: string; city: string; address: string | null; description: string; deliveryDate: Date | string; heroImage: string | null; highlights: unknown; active: boolean; published?: boolean }) {
  return {
    name: d.name, city: d.city, address: d.address, description: d.description,
    deliveryDate: typeof d.deliveryDate === 'string' ? d.deliveryDate : isoFromDate(d.deliveryDate),
    heroImage: d.heroImage, highlights: d.highlights, active: d.active,
  };
}

export async function createDevelopment(db: Db, args: { actor: string; data: unknown }) {
  requireActor(args.actor);
  const data = parse(newDevelopmentSchema, args.data);
  const deliveryDate = validDate(data.deliveryDate);
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.development.create({
        data: {
          slug: data.slug, name: data.name, city: data.city, address: data.address, description: data.description,
          deliveryDate, heroImage: data.heroImage, highlights: data.highlights, active: data.active, published: false,
        },
      });
      await recordAudit(tx, { actor: args.actor, entity: DEVELOPMENT_ENTITY, entityId: created.id, action: 'DEVELOPMENT_CREATED', after: { slug: data.slug, ...developmentSnapshot(created) } });
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new PanelValidationError({ slug: 'Já existe um empreendimento com este identificador' });
    throw err;
  }
}

export async function updateDevelopment(db: Db, args: { actor: string; id: string; data: unknown }) {
  requireActor(args.actor);
  const data = parse(developmentFormSchema, args.data);
  const deliveryDate = validDate(data.deliveryDate);
  return db.$transaction(async (tx) => {
    const current = await tx.development.findUnique({ where: { id: args.id } });
    if (!current) throw new PanelNotFoundError('empreendimento');
    const diff = changedFields(developmentSnapshot(current), developmentSnapshot({ ...data, deliveryDate: data.deliveryDate }));
    if (!diff.changed) return current;
    const updated = await tx.development.update({
      where: { id: args.id },
      data: { name: data.name, city: data.city, address: data.address, description: data.description, deliveryDate, heroImage: data.heroImage, highlights: data.highlights, active: data.active },
    });
    await recordAudit(tx, { actor: args.actor, entity: DEVELOPMENT_ENTITY, entityId: args.id, action: 'DEVELOPMENT_UPDATED', before: diff.before, after: diff.after });
    return updated;
  });
}

/** "Publicar no site" liga e desliga. Publicar exige empreendimento ativo. */
export async function setDevelopmentPublished(db: Db, args: { actor: string; id: string; published: boolean }) {
  requireActor(args.actor);
  return db.$transaction(async (tx) => {
    const current = await tx.development.findUnique({ where: { id: args.id } });
    if (!current) throw new PanelNotFoundError('empreendimento');
    if (args.published && !current.active) throw new PanelValidationError({ published: 'Reative o empreendimento antes de publicar' });
    if (current.published === args.published) return current;
    const updated = await tx.development.update({ where: { id: args.id }, data: { published: args.published } });
    await recordAudit(tx, {
      actor: args.actor, entity: DEVELOPMENT_ENTITY, entityId: args.id,
      action: args.published ? 'DEVELOPMENT_PUBLISHED' : 'DEVELOPMENT_UNPUBLISHED',
      before: { published: current.published }, after: { published: args.published },
    });
    return updated;
  });
}

const unitSnapshot = (u: { code: string; typology: string; areaM2: unknown; price: unknown; status: string }) => ({
  code: u.code, typology: u.typology, areaM2: Number(u.areaM2), price: Number(u.price), status: u.status,
});

export async function saveUnit(db: Db, args: { actor: string; developmentId: string; id?: string; data: unknown }) {
  requireActor(args.actor);
  const data = parse(unitFormSchema, args.data);
  try {
    return await db.$transaction(async (tx) => {
      const development = await tx.development.findUnique({ where: { id: args.developmentId }, select: { id: true } });
      if (!development) throw new PanelNotFoundError('empreendimento');
      if (!args.id) {
        const created = await tx.unit.create({ data: { developmentId: args.developmentId, ...data } });
        await recordAudit(tx, { actor: args.actor, entity: UNIT_ENTITY, entityId: created.id, action: 'UNIT_CREATED', after: { developmentId: args.developmentId, ...unitSnapshot(created) } });
        return created;
      }
      const current = await tx.unit.findFirst({ where: { id: args.id, developmentId: args.developmentId } });
      if (!current) throw new PanelNotFoundError('unidade');
      const diff = changedFields(unitSnapshot(current), unitSnapshot(data));
      if (!diff.changed) return current;
      const updated = await tx.unit.update({ where: { id: args.id }, data });
      await recordAudit(tx, { actor: args.actor, entity: UNIT_ENTITY, entityId: args.id, action: 'UNIT_UPDATED', before: diff.before, after: diff.after });
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new PanelValidationError({ code: 'Já existe uma unidade com este código' });
    throw err;
  }
}
