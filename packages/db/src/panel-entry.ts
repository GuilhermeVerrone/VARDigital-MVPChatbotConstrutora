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
export { SAMPLE_PROFILES, previewPayment, type PreviewArgs, type PreviewResult, type SampleProfile } from './panel/preview';
export { PanelNotFoundError, PanelValidationError } from './panel/errors';
