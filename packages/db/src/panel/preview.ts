import { parseSalesCondition, type IncomeType, type PaymentInput, type PaymentMode, type PaymentResult, type SalesCondition } from '@mvp/simulation';
import type { Db } from '../client';
import { dateFromIso } from '../convert';
import { Prisma, type Development, type FinancialProfile, type Unit } from '../generated/prisma/client';
import { computePaymentSimulation, type PaymentSimulationChoices } from '../simulation-service';
import { PanelNotFoundError } from './errors';

// Calculadora de prévia do painel: o MESMO caminho do bot (`computePaymentSimulation`), com um perfil
// de exemplo no lugar do lead e, opcionalmente, o rascunho da condição no lugar da vigente.

export interface SampleProfile {
  id: string;
  label: string;
  /** Data de nascimento do proponente (para a estimativa do banco). */
  birthDate: string;
  grossMonthlyIncome: number;
  monthlyDebts: number;
  incomeType: IncomeType;
  cashNow: number;
  acceptsBalloons: boolean;
}

/** Perfis de exemplo fixos (são só para o time conferir a condição; não são leads). */
export const SAMPLE_PROFILES: readonly SampleProfile[] = [
  { id: 'entrada-folgada', label: 'Entrada folgada (renda 18 mil, 150 mil em caixa)', birthDate: '1988-04-10', grossMonthlyIncome: 18000, monthlyDebts: 0, incomeType: 'CLT', cashNow: 150000, acceptsBalloons: true },
  { id: 'renda-media', label: 'Renda média (renda 9 mil, 40 mil em caixa)', birthDate: '1991-09-02', grossMonthlyIncome: 9000, monthlyDebts: 800, incomeType: 'CLT', cashNow: 40000, acceptsBalloons: false },
  { id: 'aperto', label: 'Orçamento apertado (renda 5 mil, 10 mil em caixa)', birthDate: '1995-01-20', grossMonthlyIncome: 5000, monthlyDebts: 600, incomeType: 'AUTONOMO', cashNow: 10000, acceptsBalloons: false },
] as const;

export interface PreviewArgs {
  unitId: string;
  mode: PaymentMode;
  profileId: string;
  /** Data da simulação ('AAAA-MM-DD'). */
  referenceDate: string;
  /** Rascunho da condição (formato do motor). Sem isto, usa a vigente na data. */
  draftCondition?: unknown;
  choices?: PaymentSimulationChoices;
}

export interface PreviewResult {
  input: PaymentInput;
  result: PaymentResult;
  /** Versão da condição vigente usada; null = rascunho. */
  conditionVersion: string | null;
  parametersVersion: string | null;
  profile: SampleProfile;
}

function syntheticProfile(p: SampleProfile): FinancialProfile {
  return {
    id: 'preview', leadId: 'preview', grossMonthlyIncome: new Prisma.Decimal(p.grossMonthlyIncome), incomeType: p.incomeType, monthlyDebts: new Prisma.Decimal(p.monthlyDebts),
    availableDownPayment: new Prisma.Decimal(p.cashNow), fgtsBalance: null, fgtsContributionMonths: null, ownsResidentialProperty: false, firstFinancing: true,
    coApplicantIncome: null, coApplicantIncomeType: null, coApplicantBirthDate: null, coApplicantMonthlyDebts: null,
    coApplicantFgtsBalance: null, coApplicantFgtsMonths: null, cashNow: new Prisma.Decimal(p.cashNow), acceptsBalloons: p.acceptsBalloons, updatedAt: new Date(0),
  } as unknown as FinancialProfile;
}

export async function previewPayment(db: Db, args: PreviewArgs): Promise<PreviewResult> {
  const profile = SAMPLE_PROFILES.find((p) => p.id === args.profileId);
  if (!profile) throw new PanelNotFoundError('perfil de exemplo');
  const unit = await db.unit.findUnique({ where: { id: args.unitId }, include: { development: true } });
  if (!unit) throw new PanelNotFoundError('unidade');
  const draft: SalesCondition | undefined = args.draftCondition === undefined ? undefined : parseSalesCondition(args.draftCondition);
  const computed = await computePaymentSimulation(db, {
    mode: args.mode,
    referenceDate: args.referenceDate,
    lead: { birthDate: dateFromIso(profile.birthDate) },
    profile: syntheticProfile(profile),
    unit: unit as Unit & { development: Development },
    ...(args.choices ? { choices: args.choices } : {}),
    ...(draft ? { conditionOverride: draft } : {}),
  });
  return {
    input: computed.input,
    result: computed.result,
    conditionVersion: computed.stored?.version ?? null,
    parametersVersion: computed.usedParameters?.version ?? null,
    profile,
  };
}
