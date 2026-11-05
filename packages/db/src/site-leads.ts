import type { Db } from './client';
import type { Prisma } from './generated/prisma/client';
import { assignContactCode } from './form-leads';
import { enqueueJob } from './jobs';

// Formulário "Simule sua condição" do site (V2, Fase 13). O site grava o lead (sem duplicar pelo
// telefone), os consentimentos WEB e o job FIRST_CONTACT. A conversa no WhatsApp só nasce quando o
// lead responde (Fase 12). Reenviar o formulário atualiza o lead e não cria outro job.

export const WEB_CONSENT_VERSION = 'web-1';
export const WEB_OPTIN_VERSION = 'web-optin-1';

export interface SiteLeadInput {
  name: string;
  /** E.164 só com dígitos (ex.: 5511999990000). */
  phone: string;
  email: string | null;
  developmentSlug: string;
  typology: string | null;
  utm: Record<string, string> | null;
  /** Texto exato mostrado ao lead no aceite da privacidade. */
  consentText: string;
  /** Texto exato do opt-in de contato por WhatsApp. */
  optInText: string;
  now?: Date;
}

export interface SiteLeadResult {
  leadId: string;
  contactCode: string;
  /** false = o telefone já era de um lead (atualizado, não duplicado). */
  created: boolean;
  /** false = o 1º contato já tinha sido enfileirado antes (reenvio do formulário). */
  firstContactQueued: boolean;
}

export class UnknownDevelopmentError extends Error {
  constructor(slug: string) {
    super(`empreendimento não publicado: ${slug}`);
    this.name = 'UnknownDevelopmentError';
  }
}

/**
 * Cria ou atualiza o lead do formulário. Idempotente pelo telefone: o mesmo número nunca gera dois
 * leads, dois consentimentos da mesma versão nem dois jobs de 1º contato.
 */
export async function submitSiteLead(db: Db, input: SiteLeadInput): Promise<SiteLeadResult> {
  const now = input.now ?? new Date();
  const development = await db.development.findFirst({ where: { slug: input.developmentSlug, published: true, active: true }, select: { id: true } });
  if (!development) throw new UnknownDevelopmentError(input.developmentSlug);

  const { leadId, created } = await db.$transaction(async (tx) => {
    const existing = await tx.lead.findUnique({ where: { phone: input.phone }, include: { _count: { select: { conversations: true } } } });
    let id: string;
    let isNew = false;
    if (existing) {
      id = existing.id;
      await tx.lead.update({
        where: { id },
        data: {
          name: existing.name ?? input.name,
          ...(input.email ? { email: input.email } : {}),
          developmentId: development.id,
          formSubmittedAt: now,
          // utm guarda a origem do 1º envio; reenvios não a sobrescrevem.
          ...(existing.utm === null && input.utm ? { utm: input.utm as Prisma.InputJsonValue } : {}),
          // Quem já conversou no WhatsApp continua como está; só o lead ainda sem conversa vira do formulário.
          ...(existing._count.conversations === 0 ? { source: 'SITE_FORM' as const, ...(existing.status === 'CLOSED' ? { status: 'NEW' as const } : {}) } : {}),
        },
      });
    } else {
      isNew = true;
      const lead = await tx.lead.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email,
          developmentId: development.id,
          source: 'SITE_FORM',
          status: 'NEW',
          origin: 'site',
          utm: (input.utm ?? undefined) as Prisma.InputJsonValue | undefined,
          formSubmittedAt: now,
        },
      });
      id = lead.id;
    }

    for (const [textVersion, textSnapshot] of [[WEB_CONSENT_VERSION, input.consentText], [WEB_OPTIN_VERSION, input.optInText]] as const) {
      const has = await tx.consent.findFirst({ where: { leadId: id, channel: 'WEB', textVersion, revokedAt: null }, select: { id: true } });
      if (!has) await tx.consent.create({ data: { leadId: id, textVersion, textSnapshot, channel: 'WEB', acceptedAt: now } });
    }
    return { leadId: id, created: isNew };
  });

  const contactCode = await assignContactCode(db, leadId);
  const firstContactQueued = await enqueueJob(db, {
    kind: 'FIRST_CONTACT',
    leadId,
    // Sem dado pessoal: só o que a mensagem e o bot precisam.
    payload: { developmentSlug: input.developmentSlug, ...(input.typology ? { typology: input.typology } : {}) },
    availableAt: now,
  });
  await db.auditLog.create({ data: { actor: 'site', entity: 'lead', entityId: leadId, action: created ? 'site_lead_created' : 'site_lead_resubmitted', after: { firstContactQueued } } });
  return { leadId, contactCode, created, firstContactQueued };
}

// ---------------------------------------------------------------------------
// Catálogo público (empreendimentos publicados)
// ---------------------------------------------------------------------------

export interface PublicTypology {
  typology: string;
  minArea: number;
  maxArea: number;
  /** Menor preço entre as unidades disponíveis da tipologia. */
  fromPrice: number;
  available: number;
}

export interface PublicDevelopment {
  slug: string;
  name: string;
  city: string;
  address: string | null;
  description: string;
  deliveryDate: string;
  heroImage: string | null;
  highlights: string[];
  gallery: { url: string; alt: string }[];
  faq: { question: string; answer: string }[];
  dataStatus: string;
  /** Preço "a partir de": o menor entre as unidades disponíveis (null se não houver). */
  fromPrice: number | null;
  typologies: PublicTypology[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const objects = <T>(v: unknown, keys: string[]): T[] =>
  (Array.isArray(v) ? v : []).filter((x) => x && typeof x === 'object' && keys.every((k) => typeof (x as Record<string, unknown>)[k] === 'string')) as T[];

type DevRow = Prisma.DevelopmentGetPayload<{ include: { units: true } }>;

function toPublic(d: DevRow): PublicDevelopment {
  const byTypology = new Map<string, PublicTypology>();
  for (const u of d.units) {
    if (u.status !== 'AVAILABLE') continue;
    const price = u.price.toNumber();
    const area = u.areaM2.toNumber();
    const cur = byTypology.get(u.typology);
    byTypology.set(
      u.typology,
      cur
        ? { ...cur, minArea: Math.min(cur.minArea, area), maxArea: Math.max(cur.maxArea, area), fromPrice: Math.min(cur.fromPrice, price), available: cur.available + 1 }
        : { typology: u.typology, minArea: area, maxArea: area, fromPrice: price, available: 1 },
    );
  }
  const typologies = [...byTypology.values()].sort((a, b) => a.minArea - b.minArea);
  return {
    slug: d.slug,
    name: d.name,
    city: d.city,
    address: d.address,
    description: d.description,
    deliveryDate: d.deliveryDate.toISOString().slice(0, 10),
    heroImage: d.heroImage,
    highlights: strings(d.highlights),
    gallery: objects<{ url: string; alt: string }>(d.gallery, ['url', 'alt']),
    faq: objects<{ question: string; answer: string }>(d.faq, ['question', 'answer']),
    dataStatus: d.dataStatus,
    fromPrice: typologies.length ? Math.min(...typologies.map((t) => t.fromPrice)) : null,
    typologies,
  };
}

/** Empreendimentos ativos marcados para aparecer no site, com o preço "a partir de" do banco. */
export async function listPublishedDevelopments(db: Pick<Db, 'development'>): Promise<PublicDevelopment[]> {
  const rows = await db.development.findMany({ where: { published: true, active: true }, orderBy: { createdAt: 'asc' }, include: { units: true } });
  return rows.map(toPublic);
}

export async function getPublishedDevelopment(db: Pick<Db, 'development'>, slug: string): Promise<PublicDevelopment | null> {
  const row = await db.development.findFirst({ where: { slug, published: true, active: true }, include: { units: true } });
  return row ? toPublic(row) : null;
}
