import {
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
import { assertCan, type PanelUser } from './permissions';

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
