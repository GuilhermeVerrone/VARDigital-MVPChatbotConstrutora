import type { Db } from '../client';
import { createFlowDraft, discardFlowDraft, FLOW_CONFIG_ENTITY, FlowConfigError, getPublishedFlowConfig, listFlowConfigs, updateFlowDraft, type FlowConfigContent, type StoredFlowConfig } from '../flow-config';
import { recordAudit, resolveActorNames } from './audit';
import { PanelValidationError, requireActor } from './errors';

// Fluxo do bot no painel (Fase 15): rascunho → publicar → reverter. Só existe UM rascunho por vez
// (o painel edita esse). A validação do conteúdo (variáveis, palavras proibidas) é do serviço do
// painel, que roda o linter antes de chamar estas funções.

export interface FlowVersionRow {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  note: string | null;
  createdAt: Date;
  createdByName: string;
  publishedAt: Date | null;
  publishedByName: string | null;
}

export interface FlowOverview {
  published: StoredFlowConfig | null;
  draft: StoredFlowConfig | null;
  /** Todas as versões, da mais nova para a mais antiga. */
  versions: FlowVersionRow[];
  /** Existe uma versão aposentada anterior à publicada (dá para reverter). */
  canRevert: boolean;
}

export async function getFlowOverview(db: Db): Promise<FlowOverview> {
  const all = await listFlowConfigs(db);
  const published = await getPublishedFlowConfig(db);
  const names = await resolveActorNames(db, all.flatMap((v) => [v.createdBy, ...(v.publishedBy ? [v.publishedBy] : [])]));
  return {
    published,
    draft: all.find((v) => v.status === 'DRAFT') ?? null,
    versions: all
      .map((v) => ({
        id: v.id, version: v.version, status: v.status, note: v.note, createdAt: v.createdAt, createdByName: names.get(v.createdBy) ?? v.createdBy,
        publishedAt: v.publishedAt, publishedByName: v.publishedBy ? (names.get(v.publishedBy) ?? v.publishedBy) : null,
      }))
      .reverse(),
    canRevert: published !== null && all.some((v) => v.status === 'RETIRED' && v.version < published.version),
  };
}

/** Salva o conteúdo no rascunho (cria o rascunho a partir da publicada se ainda não houver). */
export async function saveFlowDraft(db: Db, a: { actor: string; content: unknown }): Promise<StoredFlowConfig> {
  requireActor(a.actor);
  try {
    const existing = (await listFlowConfigs(db)).find((v) => v.status === 'DRAFT');
    if (existing) return await updateFlowDraft(db, existing.id, a.content);
    return await createFlowDraft(db, { actor: a.actor, content: a.content });
  } catch (err) {
    if (err instanceof FlowConfigError) throw new PanelValidationError({ _: err.message });
    throw err;
  }
}

/** Descarta o rascunho e registra na auditoria (nada vai ao ar). */
export async function discardPanelFlowDraft(db: Db, a: { actor: string }): Promise<void> {
  requireActor(a.actor);
  const draft = (await listFlowConfigs(db)).find((v) => v.status === 'DRAFT');
  if (!draft) return;
  await discardFlowDraft(db, draft.id);
  await recordAudit(db, { actor: a.actor, entity: FLOW_CONFIG_ENTITY, entityId: draft.id, action: 'FLOW_DRAFT_DISCARDED', before: { version: draft.version, content: draft.content } });
}

export type { FlowConfigContent, StoredFlowConfig };
