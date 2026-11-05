import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Db } from './client';
import type { FlowConfig, Prisma } from './generated/prisma/client';

// Fluxo do bot editável (V2, D11): textos por chave, etapas opcionais ligadas/desligadas, botões por
// etapa e mensagem de 1º contato. Rascunho é editável; publicada é imutável (trigger no banco) e a
// publicação aposenta a anterior. Sem versão publicada, o bot usa os textos de templates.ts. A
// validação das chaves e das variáveis dos textos (e o linter de palavras proibidas) é do editor
// (Fase 15); aqui fica só o formato.

export const FLOW_CONFIG_ENTITY = 'FlowConfig';

export const flowConfigContentSchema = z.object({
  /** Texto por chave da etapa/mensagem (ex.: "ASK_NAME"). Chave ausente = texto padrão do código. */
  texts: z.record(z.string(), z.string().min(1)).default({}),
  /** Etapas opcionais ligadas (true) ou desligadas (false). Ausente = valor padrão do código. */
  optionalSteps: z.record(z.string(), z.boolean()).default({}),
  /** Botões por etapa (rótulos curtos). Sempre há o texto numerado como alternativa. */
  buttons: z.record(z.string(), z.array(z.string().min(1).max(25)).max(3)).default({}),
  /** 1ª mensagem enviada a quem preencheu o formulário do site (double opt-in). */
  firstContact: z.string().min(1).nullable().default(null),
});
export type FlowConfigContent = z.infer<typeof flowConfigContentSchema>;

export class FlowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowConfigError';
  }
}

export interface StoredFlowConfig extends Omit<FlowConfig, 'content'> {
  content: FlowConfigContent;
}

function parseContent(raw: unknown): FlowConfigContent {
  const parsed = flowConfigContentSchema.safeParse(raw);
  if (!parsed.success) throw new FlowConfigError(`conteúdo do fluxo inválido: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
}

function fromRow(row: FlowConfig): StoredFlowConfig {
  return { ...row, content: parseContent(row.content) };
}

/** Versão publicada vigente (a de maior número), ou null: o bot usa então os textos do código. */
export async function getPublishedFlowConfig(db: Pick<Db, 'flowConfig'>): Promise<StoredFlowConfig | null> {
  const row = await db.flowConfig.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  return row ? fromRow(row) : null;
}

export async function listFlowConfigs(db: Pick<Db, 'flowConfig'>): Promise<StoredFlowConfig[]> {
  return (await db.flowConfig.findMany({ orderBy: { version: 'asc' } })).map(fromRow);
}

export interface CreateFlowDraftArgs {
  /** Conteúdo inicial; vazio = copia a publicada vigente (ou começa vazio, se não houver). */
  content?: unknown;
  actor: string;
  note?: string;
}

/** Cria um rascunho. Só pode haver um por vez: o painel edita esse, em vez de acumular rascunhos. */
export async function createFlowDraft(db: Db, a: CreateFlowDraftArgs): Promise<StoredFlowConfig> {
  if (!a.actor.trim()) throw new FlowConfigError('informe quem está alterando');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('flow_configs'))`;
    if (await tx.flowConfig.findFirst({ where: { status: 'DRAFT' } })) throw new FlowConfigError('já existe um rascunho; edite ou descarte antes de criar outro');
    const published = await getPublishedFlowConfig(tx);
    const content = a.content === undefined ? (published?.content ?? parseContent({})) : parseContent(a.content);
    const row = await tx.flowConfig.create({
      data: { content: content as Prisma.InputJsonValue, basedOnId: published?.id ?? null, createdBy: a.actor, note: a.note ?? null },
    });
    return fromRow(row);
  });
}

async function requireDraft(db: Pick<Db, 'flowConfig'>, id: string): Promise<FlowConfig> {
  const row = await db.flowConfig.findUnique({ where: { id } });
  if (!row) throw new FlowConfigError('versão do fluxo não encontrada');
  if (row.status !== 'DRAFT') throw new FlowConfigError('só rascunho pode ser editado; crie um rascunho novo');
  return row;
}

export async function updateFlowDraft(db: Db, id: string, content: unknown): Promise<StoredFlowConfig> {
  await requireDraft(db, id);
  return fromRow(await db.flowConfig.update({ where: { id }, data: { content: parseContent(content) as Prisma.InputJsonValue } }));
}

export async function discardFlowDraft(db: Db, id: string): Promise<void> {
  await requireDraft(db, id);
  await db.flowConfig.delete({ where: { id } });
}

export interface PublishFlowArgs {
  actor: string;
  reason: string;
  now: Date;
}

/** Publica o rascunho: aposenta a publicada anterior e grava auditoria (antes/depois). */
export async function publishFlowConfig(db: Db, id: string, a: PublishFlowArgs): Promise<StoredFlowConfig> {
  if (!a.actor.trim()) throw new FlowConfigError('informe quem está publicando');
  if (!a.reason.trim()) throw new FlowConfigError('informe o motivo da publicação');
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtext('flow_configs'))`;
    const draft = await requireDraft(tx, id);
    const content = parseContent(draft.content);
    const previous = await getPublishedFlowConfig(tx);
    if (previous && isDeepStrictEqual(previous.content, content)) throw new FlowConfigError('nada mudou em relação à versão publicada');

    if (previous) await tx.flowConfig.update({ where: { id: previous.id }, data: { status: 'RETIRED' } });
    const published = await tx.flowConfig.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: a.now, publishedBy: a.actor, basedOnId: previous?.id ?? draft.basedOnId },
    });
    await tx.auditLog.create({
      data: {
        actor: a.actor,
        entity: FLOW_CONFIG_ENTITY,
        entityId: published.id,
        action: 'FLOW_PUBLISHED',
        reason: a.reason,
        before: previous ? ({ version: previous.version, content: previous.content } as Prisma.InputJsonValue) : undefined,
        after: { version: published.version, content } as Prisma.InputJsonValue,
      },
    });
    return fromRow(published);
  });
}
