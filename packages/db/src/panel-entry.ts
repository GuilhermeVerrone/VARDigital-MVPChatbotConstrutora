// Entrada do banco para o painel (Next.js): só o que as telas do painel usam, sem o bot (conversa,
// canal, CRM) no bundle do servidor.
export { createDb, type Db } from './client';
export { addDays, dateFromIso, isoFromDate, todayIso } from './convert';
export * from './generated/prisma/enums';
export { createUser, findSessionUser, login, logout, MIN_PASSWORD_LENGTH, SESSION_HOURS, type LoginResult } from './users';
export type { User } from './generated/prisma/client';
export {
  diffSalesConditions,
  getSalesConditionByVersion,
  getSalesConditionInForce,
  listSalesConditionAudit,
  listSalesConditions,
  publishSalesCondition,
  SalesConditionTimelineError,
  NoSalesConditionInForceError,
  type PublishSalesConditionResult,
  type StoredSalesCondition,
} from './sales-conditions/repository';
export type { ParameterChange } from './parameters/changes';
export { getFinancingView, financingLineSchema, publishFinancingLine, type FinancingLineForm, type FinancingView } from './panel/financing';
export { auditFilterOptions, listAuditLogs, recordAudit, resolveActorNames, type AuditFilter, type AuditRow } from './panel/audit';
export {
  createDevelopment,
  developmentFormSchema,
  getAdminDevelopment,
  listAdminDevelopments,
  saveUnit,
  setDevelopmentPublished,
  unitFormSchema,
  updateDevelopment,
  type AdminDevelopment,
  type AdminUnit,
} from './panel/catalog';
export { brokerFormSchema, listAdminBrokers, saveBroker } from './panel/brokers';
export { SAMPLE_PROFILES, previewPayment, simulateCollected, type CollectedSimulationArgs, type PreviewArgs, type PreviewResult, type SampleProfile } from './panel/preview';
export { isSimulationDataError } from './simulation-service';
export { PanelNotFoundError, PanelValidationError } from './panel/errors';
export {
  LEADS_PAGE_SIZE,
  assignLeadBroker,
  findLeadHandoff,
  getPanelLead,
  listPanelLeads,
  releaseLeadHandoff,
  requireLeadInScope,
  takeLeadHandoff,
  verdictOfClass,
  type LeadDetail,
  type LeadFilter,
  type LeadRow,
  type LeadScope,
  type PanelHandoffResult,
  type ReleasableLeadHandoff,
  type TimelineEvent,
} from './panel/leads';
export { getPanelDashboard, startOfTodaySp, type PanelDashboard } from './panel/dashboard';
export { eraseLead, type ErasureSummary } from './erasure';
export { loadSimulationBundle, type SimulationBundle } from './dossier-data';
export { listDevelopmentCatalog } from './conversations';
export {
  FlowConfigError, flowConfigContentSchema, getPublishedFlowConfig, publishFlowConfig, revertFlowConfig,
  type FlowConfigContent, type PublishFlowArgs, type StoredFlowConfig,
} from './flow-config';
export { discardPanelFlowDraft, getFlowOverview, saveFlowDraft, type FlowOverview, type FlowVersionRow } from './panel/flow';
export { toPaymentView, toView } from './views';
