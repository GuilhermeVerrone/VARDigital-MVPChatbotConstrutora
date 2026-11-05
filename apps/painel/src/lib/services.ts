import {
  initialSnapshot, lintFlowContent, flowErrors, resumeAfterHandoff, type FlowEnv, type FlowIssue, type FlowSettings, type Snapshot,
} from '@mvp/conversation';
import {
  assignLeadBroker,
  discardPanelFlowDraft,
  eraseLead,
  findLeadHandoff,
  FlowConfigError,
  getFlowOverview,
  getPanelDashboard,
  getPanelLead,
  getPublishedFlowConfig,
  listDevelopmentCatalog,
  listPanelLeads,
  publishFlowConfig,
  releaseLeadHandoff,
  requireLeadInScope,
  revertFlowConfig,
  saveFlowDraft,
  takeLeadHandoff,
  type LeadFilter,
  createDevelopment,
  diffSalesConditions,
  dateFromIso,
  getAdminDevelopment,
  getSalesConditionInForce,
  listAdminDevelopments,
  listAdminBrokers,
  listSalesConditions,
  previewPayment,
  PanelValidationError,
  publishFinancingLine,
  publishSalesCondition,
  saveBroker,
  saveUnit,
  setDevelopmentPublished,
  updateDevelopment,
  todayIso,
  type Db,
  type ParameterChange,
  type PreviewResult,
} from '@mvp/db/panel';
import { offeredModes, parseSalesCondition, type PaymentMode, type SalesCondition } from '@mvp/simulation';
import { valuesToCondition } from './condition-form';
import { valuesToContent, issuesByField, type FlowFormValues } from './flow-form';
import { assertCan, leadScope, type PanelUser } from './permissions';

// Serviços do painel: cada função confere a permissão do papel ANTES de tocar no banco e grava a
// auditoria com o id do usuário. As Server Actions são finas: leem o formulário e chamam estas.

export interface ServiceCtx {
  db: Db;
  user: PanelUser;
  /** Hoje ('AAAA-MM-DD'); injetado nos testes. */
  today?: string;
}
const today = (ctx: ServiceCtx) => ctx.today ?? todayIso();

// -- Empreendimentos e unidades ----------------------------------------------------------------

export const developmentsService = {
  list: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'developments:read');
    return listAdminDevelopments(ctx.db);
  },
  get: async (ctx: ServiceCtx, id: string) => {
    assertCan(ctx.user, 'developments:read');
    return getAdminDevelopment(ctx.db, id);
  },
  create: async (ctx: ServiceCtx, data: unknown) => {
    assertCan(ctx.user, 'developments:write');
    return createDevelopment(ctx.db, { actor: ctx.user.id, data });
  },
  update: async (ctx: ServiceCtx, id: string, data: unknown) => {
    assertCan(ctx.user, 'developments:write');
    return updateDevelopment(ctx.db, { actor: ctx.user.id, id, data });
  },
  setPublished: async (ctx: ServiceCtx, id: string, published: boolean) => {
    assertCan(ctx.user, 'developments:write');
    return setDevelopmentPublished(ctx.db, { actor: ctx.user.id, id, published });
  },
  saveUnit: async (ctx: ServiceCtx, developmentId: string, unitId: string | undefined, data: unknown) => {
    assertCan(ctx.user, 'developments:write');
    return saveUnit(ctx.db, { actor: ctx.user.id, developmentId, ...(unitId ? { id: unitId } : {}), data });
  },
};

// -- Corretores ------------------------------------------------------------------------------

export const brokersService = {
  list: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'brokers:read');
    return listAdminBrokers(ctx.db);
  },
  save: async (ctx: ServiceCtx, id: string | undefined, data: unknown) => {
    assertCan(ctx.user, 'brokers:write');
    return saveBroker(ctx.db, { actor: ctx.user.id, ...(id ? { id } : {}), data });
  },
};

// -- Financiamento simulado --------------------------------------------------------------------

export const financingService = {
  publishLine: async (ctx: ServiceCtx, data: unknown) => {
    assertCan(ctx.user, 'financing:write');
    return publishFinancingLine(ctx.db, { actor: ctx.user.id, today: today(ctx), data });
  },
};

// -- Condições comerciais ----------------------------------------------------------------------

export interface ConditionDraftInput {
  developmentId: string;
  values: Record<string, string>;
  /** Início da vigência ('AAAA-MM-DD'). */
  validFrom: string;
  reason: string;
}

export interface DraftCheck {
  condition: SalesCondition | null;
  errors: Record<string, string>;
  /** Diferença do rascunho para a condição vigente em `validFrom`. */
  changes: ParameterChange[];
  current: { version: string; validFrom: string } | null;
}

/** Valida o rascunho e calcula o diff contra a vigente. Não grava nada. */
export async function checkConditionDraft(ctx: ServiceCtx, input: Pick<ConditionDraftInput, 'developmentId' | 'values' | 'validFrom'>): Promise<DraftCheck> {
  assertCan(ctx.user, 'conditions:read');
  const errors: Record<string, string> = {};
  try {
    dateFromIso(input.validFrom);
  } catch {
    errors.validFrom = 'Data inválida (AAAA-MM-DD)';
  }
  const built = valuesToCondition(input.values, { validFrom: errors.validFrom ? '2000-01-01' : input.validFrom, version: 'rascunho' });
  Object.assign(errors, built.errors);
  const current = errors.validFrom ? null : await getSalesConditionInForceOrNull(ctx.db, input.developmentId, input.validFrom);
  return {
    condition: built.condition,
    errors,
    changes: built.condition ? diffSalesConditions(current?.condition ?? null, built.condition) : [],
    current: current ? { version: current.version, validFrom: current.validFrom } : null,
  };
}

async function getSalesConditionInForceOrNull(db: Db, developmentId: string, date: string) {
  try {
    return await getSalesConditionInForce(db, developmentId, date);
  } catch {
    return null;
  }
}

/** Publica o rascunho como nova versão, com vigência e motivo. */
export async function publishConditionDraft(ctx: ServiceCtx, input: ConditionDraftInput) {
  assertCan(ctx.user, 'conditions:write');
  const check = await checkConditionDraft(ctx, input);
  if (!check.condition) throw new PanelValidationError({ ...check.errors, ...(Object.keys(check.errors).length === 0 ? { _: 'Condição inválida' } : {}) });
  if (!input.reason.trim()) throw new PanelValidationError({ reason: 'Informe o motivo da alteração' });
  const dev = await getAdminDevelopment(ctx.db, input.developmentId);
  const n = (await listSalesConditions(ctx.db, input.developmentId)).length + 1;
  try {
    return await publishSalesCondition(ctx.db, {
      developmentId: input.developmentId,
      condition: check.condition,
      version: `${dev.slug}-v${n}-${input.validFrom}`,
      validFrom: input.validFrom,
      actor: ctx.user.id,
      reason: input.reason,
      today: today(ctx),
      ...(check.current ? { expectedPreviousVersion: check.current.version } : {}),
    });
  } catch (err) {
    // Erros da linha do tempo (retroativo, nada mudou, versão futura) são mensagens para o usuário.
    if (err instanceof Error && err.name === 'SalesConditionTimelineError') throw new PanelValidationError({ _: err.message });
    throw err;
  }
}

export interface PreviewInput {
  developmentId: string;
  unitId: string;
  profileId: string;
  /** Rascunho do formulário; ausente = condição vigente. */
  values?: Record<string, string>;
  referenceDate?: string;
}

export interface PreviewOutput {
  referenceDate: string;
  conditionVersion: string | null;
  /** Cada modo traz o resultado ou o motivo de não ter sido calculado (um modo com erro não apaga os outros). */
  modes: { mode: PaymentMode; preview?: PreviewResult; error?: string }[];
  /** Modos que a condição não oferece (ficam fora da prévia). */
  notOffered: PaymentMode[];
}

/** Prévia dos 3 modos com o MESMO caminho do bot (`computePaymentSimulation`). */
export async function previewConditionService(ctx: ServiceCtx, input: PreviewInput): Promise<PreviewOutput> {
  assertCan(ctx.user, 'conditions:read');
  const referenceDate = input.referenceDate ?? today(ctx);
  let draft: SalesCondition | undefined;
  if (input.values) {
    const built = valuesToCondition(input.values, { validFrom: referenceDate, version: 'rascunho' });
    if (!built.condition) throw new PanelValidationError(built.errors);
    draft = parseSalesCondition(built.condition);
  }
  const vigente = draft ?? (await getSalesConditionInForce(ctx.db, input.developmentId, referenceDate)).condition;
  const offered = offeredModes(vigente);
  const all: PaymentMode[] = ['A_VISTA', 'ENTRADA_A_VISTA', 'ENTRADA_PARCELADA'];
  const modes: PreviewOutput['modes'] = [];
  for (const mode of offered) {
    try {
      modes.push({ mode, preview: await previewPayment(ctx.db, { unitId: input.unitId, mode, profileId: input.profileId, referenceDate, ...(draft ? { draftCondition: draft } : {}) }) });
    } catch (err) {
      if (err instanceof Error && !(err instanceof TypeError)) modes.push({ mode, error: err.message });
      else throw err;
    }
  }
  return { referenceDate, conditionVersion: modes.find((m) => m.preview)?.preview?.conditionVersion ?? null, modes, notOffered: all.filter((m) => !offered.includes(m)) };
}

// -- Fluxo do bot -----------------------------------------------------------------------------------

/** O fluxo como o bot o enxerga (textos, etapas opcionais e 1º contato). */
export const toFlowSettings = (c: { texts: Record<string, string>; optionalSteps: Record<string, boolean>; firstContact: string | null }): FlowSettings => ({
  texts: c.texts, optionalSteps: c.optionalSteps, firstContact: c.firstContact,
});

/** O ambiente da conversa (mesmo desenho do orquestrador do bot), com o fluxo que o chamador escolher. */
export async function buildFlowEnv(db: Db, today: string, flow: FlowSettings | undefined, channelPhone: string | null = null): Promise<FlowEnv> {
  const catalog = await listDevelopmentCatalog(db, today);
  const first = catalog[0];
  return {
    today,
    developmentName: first?.name ?? 'Elevare',
    typologies: (first?.typologies ?? []).map((t) => ({ id: t, label: t })),
    channelPhone,
    developments: catalog.map((c) => ({ id: c.id, name: c.name, typologies: c.typologies.map((t) => ({ id: t, label: t })), ...(c.sales ? { sales: c.sales } : {}) })),
    ...(flow ? { flow } : {}),
  };
}

const flowFields = (issues: readonly FlowIssue[]) => issuesByField(flowErrors(issues));

export const flowService = {
  overview: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'flow:read');
    return getFlowOverview(ctx.db);
  },
  /** Valida o formulário sem gravar (para mostrar os problemas enquanto o texto é editado). */
  check: (ctx: ServiceCtx, values: FlowFormValues): FlowIssue[] => {
    assertCan(ctx.user, 'flow:read');
    return lintFlowContent(valuesToContent(values));
  },
  /** Salva o rascunho. Problemas de texto NÃO impedem salvar (é trabalho em andamento); impedem publicar. */
  saveDraft: async (ctx: ServiceCtx, values: FlowFormValues) => {
    assertCan(ctx.user, 'flow:write');
    const content = valuesToContent(values);
    const draft = await saveFlowDraft(ctx.db, { actor: ctx.user.id, content });
    return { draft, issues: lintFlowContent(draft.content) };
  },
  discardDraft: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'flow:write');
    await discardPanelFlowDraft(ctx.db, { actor: ctx.user.id });
  },
  /** Publica o RASCUNHO SALVO (não o que está na tela). Variável inválida ou palavra proibida: não publica. */
  publish: async (ctx: ServiceCtx, reason: string) => {
    assertCan(ctx.user, 'flow:write');
    const { draft } = await getFlowOverview(ctx.db);
    if (!draft) throw new PanelValidationError({ _: 'Não há rascunho para publicar. Salve as alterações primeiro.' });
    const issues = lintFlowContent(draft.content);
    const errors = flowErrors(issues);
    if (errors.length > 0) {
      throw new PanelValidationError({ ...flowFields(issues), _: `Não publicado: ${errors.length} problema${errors.length > 1 ? 's' : ''} no texto. Corrija e salve de novo.` });
    }
    if (!reason.trim()) throw new PanelValidationError({ reason: 'Informe o motivo da publicação' });
    try {
      return await publishFlowConfig(ctx.db, draft.id, { actor: ctx.user.id, reason, now: new Date() });
    } catch (err) {
      if (err instanceof FlowConfigError) throw new PanelValidationError({ _: err.message });
      throw err;
    }
  },
  revert: async (ctx: ServiceCtx, reason: string) => {
    assertCan(ctx.user, 'flow:write');
    if (!reason.trim()) throw new PanelValidationError({ reason: 'Informe o motivo da reversão' });
    try {
      return await revertFlowConfig(ctx.db, { actor: ctx.user.id, reason, now: new Date() });
    } catch (err) {
      if (err instanceof FlowConfigError) throw new PanelValidationError({ _: err.message });
      throw err;
    }
  },
  published: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'flow:read');
    return getPublishedFlowConfig(ctx.db);
  },
};

// -- Leads ------------------------------------------------------------------------------------------

export const leadsService = {
  list: async (ctx: ServiceCtx, filter: LeadFilter) => {
    assertCan(ctx.user, 'leads:read');
    return listPanelLeads(ctx.db, filter, leadScope(ctx.user));
  },
  get: async (ctx: ServiceCtx, id: string) => {
    assertCan(ctx.user, 'leads:read');
    return getPanelLead(ctx.db, id, leadScope(ctx.user));
  },
  dashboard: async (ctx: ServiceCtx) => {
    assertCan(ctx.user, 'home');
    return getPanelDashboard(ctx.db, leadScope(ctx.user), new Date());
  },
  assign: async (ctx: ServiceCtx, leadId: string, brokerId: string | null) => {
    assertCan(ctx.user, 'leads:assign');
    return assignLeadBroker(ctx.db, { actor: ctx.user.id, leadId, brokerId, scope: leadScope(ctx.user) });
  },
  /** Assume o handoff como o corretor do usuário. Gestão sem corretor vinculado atribui o lead e o corretor assume. */
  takeHandoff: async (ctx: ServiceCtx, leadId: string) => {
    assertCan(ctx.user, 'leads:handoff');
    if (!ctx.user.brokerId) throw new PanelValidationError({ _: 'Seu usuário não está vinculado a um corretor. Atribua o lead a um corretor.' });
    return takeLeadHandoff(ctx.db, { actor: ctx.user.id, leadId, brokerId: ctx.user.brokerId, scope: leadScope(ctx.user) });
  },
  /**
   * Devolve a conversa ao bot: calcula a retomada com a MESMA máquina do bot (volta à pergunta em que
   * o lead estava) e pede ao bot que envie a próxima pergunta ao lead. Gestão pode devolver a conversa
   * de qualquer corretor; o corretor só a que ele assumiu.
   */
  releaseHandoff: async (ctx: ServiceCtx, leadId: string) => {
    assertCan(ctx.user, 'leads:handoff');
    const scope = leadScope(ctx.user);
    const found = await findLeadHandoff(ctx.db, leadId, scope);
    if (!found) return { ok: false as const, reason: 'no_handoff' as const };
    const at = new Date();
    const published = await getPublishedFlowConfig(ctx.db);
    const env = await buildFlowEnv(ctx.db, ctx.today ?? todayIso(at), published ? toFlowSettings(published.content) : undefined);
    const saved = (found.context ?? {}) as Partial<Snapshot>;
    const snap: Snapshot = { ...initialSnapshot(), ...saved, state: found.state as Snapshot['state'], history: Array.isArray(found.history) ? (found.history as Snapshot['history']) : [] };
    const { snapshot } = resumeAfterHandoff(snap, env, at.toISOString());
    const { history, ...context } = snapshot;
    return releaseLeadHandoff(ctx.db, {
      actor: ctx.user.id,
      leadId,
      brokerId: ctx.user.brokerId,
      force: ctx.user.role !== 'CORRETOR',
      scope,
      now: at,
      next: { state: snapshot.state, context: context as object as never, history: history as object[] as never, leadStatus: snapshot.simulationId ? 'DELIVERED' : 'IN_PROGRESS' },
      flush: snapshot.outbox.length > 0 && found.chatId !== null,
    });
  },
  /** Apaga o lead e tudo que depende dele (LGPD). Quem pede fica na auditoria; o conteúdo não. */
  requestErasure: async (ctx: ServiceCtx, leadId: string, confirmation: string) => {
    assertCan(ctx.user, 'leads:erase');
    if (confirmation.trim().toUpperCase() !== 'EXCLUIR') throw new PanelValidationError({ confirmation: 'Digite EXCLUIR para confirmar' });
    await requireLeadInScope(ctx.db, leadId, leadScope(ctx.user));
    return eraseLead(ctx.db, leadId, { reason: 'titular', actor: ctx.user.id });
  },
};
