import { simulate, type SimulationInput, type SimulationResult } from '@mvp/simulation';
import type { Db } from './client';
import { dateFromIso, isoFromDate, jsonOrDbNull, num } from './convert';
import type { Development, FinancialProfile, Lead, Prisma, Simulation, Unit } from './generated/prisma/client';
import { getParametersInForce, type LoadParametersOptions } from './parameters/repository';

// Liga banco e motor: monta a entrada a partir do lead/perfil/unidade, lê os parâmetros
// VIGENTES na data de referência e grava a simulação com a versão usada (spec §10
// parametros_versao). O motor continua puro; todo I/O fica aqui.

export class MissingSimulationDataError extends Error {
  constructor(readonly missing: string[]) {
    super(`dados insuficientes para simular: ${missing.join(', ')}`);
    this.name = 'MissingSimulationDataError';
  }
}

export interface SimulationChoices {
  system?: 'SAC' | 'PRICE';
  desiredTermMonths?: number;
  useFullDownPayment?: boolean;
  /** Entrada informada num ajuste ("e se eu der 80 mil?"): vale só nesta simulação, o perfil não muda. */
  availableDownPayment?: number;
}

/** Monta a entrada do motor. Pura: não acessa banco. */
export function buildSimulationInput(args: {
  lead: Pick<Lead, 'birthDate'>;
  profile: FinancialProfile;
  unit: Pick<Unit, 'price'>;
  development: Pick<Development, 'deliveryDate' | 'signalRatio' | 'balloonRatio' | 'balloonIntervalMonths'>;
  referenceDate: string;
  choices?: SimulationChoices;
}): SimulationInput {
  const { lead, profile: p, unit, development: d, referenceDate, choices = {} } = args;
  const missing: string[] = [];
  if (!lead.birthDate) missing.push('lead.birthDate');
  const hasCo = p.coApplicantIncome !== null;
  if (hasCo && !p.coApplicantBirthDate) missing.push('profile.coApplicantBirthDate');
  if (hasCo && !p.coApplicantIncomeType) missing.push('profile.coApplicantIncomeType');
  if (missing.length > 0) throw new MissingSimulationDataError(missing);

  const fgts = (balance: Prisma.Decimal | null, months: number | null) =>
    balance === null ? null : { balance: num(balance), contributionMonths: months ?? 0 };

  const delivery = isoFromDate(d.deliveryDate);
  const hasPlan = d.signalRatio !== null && d.balloonRatio !== null && d.balloonIntervalMonths !== null;
  // Empreendimento já entregue: sem fluxo de obra (entrada à vista).
  const construction =
    hasPlan && delivery >= referenceDate
      ? { deliveryDate: delivery, signalRatio: num(d.signalRatio!), balloonRatio: num(d.balloonRatio!), balloonIntervalMonths: d.balloonIntervalMonths! }
      : null;

  return {
    referenceDate,
    propertyValue: num(unit.price),
    applicant: {
      birthDate: isoFromDate(lead.birthDate!),
      grossMonthlyIncome: num(p.grossMonthlyIncome),
      incomeType: p.incomeType,
      monthlyDebts: num(p.monthlyDebts),
      fgts: fgts(p.fgtsBalance, p.fgtsContributionMonths),
    },
    coApplicant: hasCo
      ? {
          birthDate: isoFromDate(p.coApplicantBirthDate!),
          grossMonthlyIncome: num(p.coApplicantIncome!),
          incomeType: p.coApplicantIncomeType!,
          monthlyDebts: p.coApplicantMonthlyDebts === null ? 0 : num(p.coApplicantMonthlyDebts),
          fgts: fgts(p.coApplicantFgtsBalance, p.coApplicantFgtsMonths),
        }
      : null,
    availableDownPayment: choices.availableDownPayment ?? num(p.availableDownPayment),
    ownsResidentialProperty: p.ownsResidentialProperty,
    firstFinancing: p.firstFinancing,
    construction,
    ...(choices.system ? { system: choices.system } : {}),
    ...(choices.desiredTermMonths ? { desiredTermMonths: choices.desiredTermMonths } : {}),
    ...(choices.useFullDownPayment !== undefined ? { useFullDownPayment: choices.useFullDownPayment } : {}),
  };
}

export interface RunSimulationArgs extends LoadParametersOptions {
  leadId: string;
  unitId: string;
  /** Data da simulação ('AAAA-MM-DD'): define idade, vigência dos parâmetros e meses até a entrega. */
  referenceDate: string;
  choices?: SimulationChoices;
}

export interface RecordedSimulation {
  simulation: Simulation;
  result: SimulationResult;
}

/** Simula com os parâmetros vigentes na data e grava a simulação com a versão usada. */
export async function runAndRecordSimulation(db: Db, args: RunSimulationArgs): Promise<RecordedSimulation> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: args.leadId }, include: { financialProfile: true } });
  if (!lead.financialProfile) throw new MissingSimulationDataError(['financialProfile']);
  const unit = await db.unit.findUniqueOrThrow({ where: { id: args.unitId }, include: { development: true } });

  const input = buildSimulationInput({
    lead,
    profile: lead.financialProfile,
    unit,
    development: unit.development,
    referenceDate: args.referenceDate,
    ...(args.choices ? { choices: args.choices } : {}),
  });
  const parameterSet = await getParametersInForce(db, args.referenceDate, args);
  const result = simulate(input, parameterSet.params);

  const selected = result.selected;
  const financing = selected?.financing ?? null;
  const creditLine = selected
    ? await db.creditLine.findUniqueOrThrow({
        where: { parameterSetId_code: { parameterSetId: parameterSet.id, code: selected.lineId } },
        select: { id: true },
      })
    : null;

  const simulation = await db.simulation.create({
    data: {
      leadId: lead.id,
      unitId: unit.id,
      creditLineId: creditLine?.id ?? null,
      system: financing?.system ?? null,
      termMonths: selected?.term?.months ?? null,
      referenceDate: dateFromIso(args.referenceDate),
      propertyValue: result.propertyValue,
      financedAmount: financing?.financedAmount ?? null,
      requiredDownPayment: financing?.requiredDownPayment ?? null,
      subsidy: financing?.subsidy ?? null,
      fgtsUsed: financing?.fgtsUsed ?? null,
      firstInstallment: financing?.firstInstallment?.total ?? null,
      lastInstallment: financing?.lastInstallment?.total ?? null,
      constructionFlow: jsonOrDbNull(financing?.constructionFlow ?? null),
      verdict: result.verdict,
      parametersVersion: parameterSet.version,
      parameterSetId: parameterSet.id,
      input: input as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
    },
  });
  return { simulation, result };
}

/**
 * Unidade usada na simulação de quem escolheu uma tipologia: a de menor preço disponível. É um
 * valor de referência (o lead não escolheu uma unidade específica) e a mensagem diz isso.
 */
export async function pickUnitForTypology(db: Db, typology: string): Promise<Unit | null> {
  return db.unit.findFirst({
    where: { typology, status: 'AVAILABLE', development: { active: true } },
    orderBy: [{ price: 'asc' }, { code: 'asc' }],
  });
}
