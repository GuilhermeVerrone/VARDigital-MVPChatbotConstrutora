import {
  InvalidPaymentInputError,
  InvalidSalesConditionError,
  InvalidSimulationInputError,
  ParametersNotInForceError,
  PaymentModeNotOfferedError,
  SalesConditionNotInForceError,
  simulate,
  simulatePayment,
  type FinancingProfile,
  type PaymentInput,
  type PaymentMode,
  type PaymentResult,
  type SalesCondition,
  type SimulationInput,
  type SimulationResult,
} from '@mvp/simulation';
import type { Db } from './client';
import { dateFromIso, isoFromDate, jsonOrDbNull, num } from './convert';
import type { Development, FinancialProfile, Lead, Prisma, Simulation, Unit } from './generated/prisma/client';
import {
  findParametersInForce,
  getParametersInForce,
  IllustrativeParametersRejectedError,
  NoParametersInForceError,
  type LoadParametersOptions,
} from './parameters/repository';
import {
  getSalesConditionInForce,
  IllustrativeSalesConditionRejectedError,
  NoSalesConditionInForceError,
  type LoadSalesConditionOptions,
} from './sales-conditions/repository';

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
  /** Parcela que o lead quer pagar (teto com folga pequena); vale só nesta simulação. */
  desiredInstallment?: number;
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
    ...(choices.desiredInstallment ? { desiredInstallment: choices.desiredInstallment } : {}),
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

// ---------------------------------------------------------------------------
// V2: simulação por forma de pagamento (à vista, entrada à vista, entrada parcelada)
// ---------------------------------------------------------------------------

export interface PaymentSimulationChoices {
  /** Dinheiro disponível hoje (ato/entrada); vale só nesta simulação. Padrão: o do perfil. */
  cashNow?: number;
  /** Mensal que o lead quer pagar (modo 3). */
  desiredInstallment?: number;
  /** Aceita reforços (modo 3). Padrão: o do perfil; sem resposta, não aceita. */
  acceptsBalloons?: boolean;
  /** Entrada que o lead quer dar (modos 2 e 3); vazio = a mínima da condição. */
  desiredDownPayment?: number;
  system?: 'SAC' | 'PRICE';
  desiredTermMonths?: number;
  /** true = não estimar o financiamento do saldo, mesmo com a condição ligada (etapa desligada no painel). */
  skipBankEstimate?: boolean;
}

type PaymentLead = Pick<Lead, 'birthDate'>;
type PaymentUnit = Pick<Unit, 'price'>;
type PaymentDevelopment = Pick<Development, 'deliveryDate'>;

function proponentFrom(birthDate: Date, income: Prisma.Decimal, incomeType: FinancialProfile['incomeType'], debts: Prisma.Decimal | null, fgts: { balance: Prisma.Decimal | null; months: number | null }) {
  return {
    birthDate: isoFromDate(birthDate),
    grossMonthlyIncome: num(income),
    incomeType,
    monthlyDebts: debts === null ? 0 : num(debts),
    fgts: fgts.balance === null ? null : { balance: num(fgts.balance), contributionMonths: fgts.months ?? 0 },
  };
}

/** Monta a entrada do motor de pagamento a partir do lead, do perfil, da unidade e da condição. Pura. */
export function buildPaymentInput(args: {
  mode: PaymentMode;
  lead: PaymentLead;
  profile: FinancialProfile | null;
  unit: PaymentUnit;
  development: PaymentDevelopment;
  condition: SalesCondition;
  referenceDate: string;
  choices?: PaymentSimulationChoices;
}): PaymentInput {
  const { mode, lead, profile: p, unit, development, condition, referenceDate, choices = {} } = args;
  const common = { referenceDate, unitPrice: num(unit.price), deliveryDate: isoFromDate(development.deliveryDate) };
  if (mode === 'A_VISTA') return { ...common, mode };

  const missing: string[] = [];
  const cashNow = choices.cashNow ?? (p?.cashNow ? num(p.cashNow) : p ? num(p.availableDownPayment) : undefined);
  if (cashNow === undefined) missing.push('cashNow');

  // A estimativa do financiamento do saldo é opcional (D10): só pede data de nascimento se estiver ligada.
  let financing: FinancingProfile | null = null;
  if (condition.bankEstimate.enabled && !choices.skipBankEstimate) {
    if (!p) missing.push('financialProfile');
    else {
      const hasCo = p.coApplicantIncome !== null;
      if (!lead.birthDate) missing.push('lead.birthDate');
      if (hasCo && !p.coApplicantBirthDate) missing.push('profile.coApplicantBirthDate');
      if (hasCo && !p.coApplicantIncomeType) missing.push('profile.coApplicantIncomeType');
      if (missing.length === 0) {
        financing = {
          applicant: proponentFrom(lead.birthDate!, p.grossMonthlyIncome, p.incomeType, p.monthlyDebts, { balance: p.fgtsBalance, months: p.fgtsContributionMonths }),
          coApplicant: hasCo
            ? proponentFrom(p.coApplicantBirthDate!, p.coApplicantIncome!, p.coApplicantIncomeType!, p.coApplicantMonthlyDebts, {
                balance: p.coApplicantFgtsBalance,
                months: p.coApplicantFgtsMonths,
              })
            : null,
          ownsResidentialProperty: p.ownsResidentialProperty,
          firstFinancing: p.firstFinancing,
          ...(choices.system ? { system: choices.system } : {}),
          ...(choices.desiredTermMonths ? { desiredTermMonths: choices.desiredTermMonths } : {}),
        };
      }
    }
  }

  if (mode === 'ENTRADA_A_VISTA') {
    if (missing.length > 0) throw new MissingSimulationDataError(missing);
    return {
      ...common,
      mode,
      cashNow: cashNow!,
      ...(choices.desiredDownPayment ? { desiredDownPayment: choices.desiredDownPayment } : {}),
      financing,
    };
  }

  if (!p) missing.push('financialProfile');
  if (missing.length > 0 || !p) throw new MissingSimulationDataError([...new Set(missing)]);
  const buyers = [{ grossMonthlyIncome: num(p.grossMonthlyIncome), monthlyDebts: num(p.monthlyDebts) }];
  if (p.coApplicantIncome !== null) {
    buyers.push({ grossMonthlyIncome: num(p.coApplicantIncome), monthlyDebts: p.coApplicantMonthlyDebts === null ? 0 : num(p.coApplicantMonthlyDebts) });
  }
  return {
    ...common,
    mode,
    cashNow: cashNow!,
    buyers,
    acceptsBalloons: choices.acceptsBalloons ?? p.acceptsBalloons ?? false,
    ...(choices.desiredInstallment ? { desiredInstallment: choices.desiredInstallment } : {}),
    ...(choices.desiredDownPayment ? { desiredDownPayment: choices.desiredDownPayment } : {}),
    financing,
  };
}

export interface RunPaymentSimulationArgs extends LoadParametersOptions, LoadSalesConditionOptions {
  leadId: string;
  unitId: string;
  mode: PaymentMode;
  /** Data da simulação ('AAAA-MM-DD'): define a vigência da condição e dos parâmetros e os meses até as chaves. */
  referenceDate: string;
  choices?: PaymentSimulationChoices;
}

export interface RecordedPaymentSimulation {
  simulation: Simulation;
  result: PaymentResult;
  salesConditionVersion: string;
  /** Versão dos parâmetros bancários usada na estimativa; null se não houve estimativa. */
  parametersVersion: string | null;
}

/**
 * Simula a forma de pagamento escolhida com a condição comercial VIGENTE do empreendimento na data
 * e grava a simulação com o modo, o plano da entrada e as versões usadas (condição e, se houve
 * estimativa do banco, parâmetros). O motor continua puro; todo I/O fica aqui.
 */
export async function runAndRecordPaymentSimulation(db: Db, args: RunPaymentSimulationArgs): Promise<RecordedPaymentSimulation> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: args.leadId }, include: { financialProfile: true } });
  const unit = await db.unit.findUniqueOrThrow({ where: { id: args.unitId }, include: { development: true } });
  const stored = await getSalesConditionInForce(db, unit.developmentId, args.referenceDate, args);

  const input = buildPaymentInput({
    mode: args.mode,
    lead,
    profile: lead.financialProfile,
    unit,
    development: unit.development,
    condition: stored.condition,
    referenceDate: args.referenceDate,
    ...(args.choices ? { choices: args.choices } : {}),
  });

  // Parâmetros bancários só entram se a estimativa vai ser calculada; fora da vigência, o motor avisa.
  const wantsEstimate = input.mode !== 'A_VISTA' && Boolean(input.financing);
  const parameterSet = wantsEstimate ? await findParametersInForce(db, args.referenceDate) : null;
  if (parameterSet && args.rejectIllustrative && parameterSet.params.status === 'ILUSTRATIVO') {
    throw new IllustrativeParametersRejectedError(parameterSet.version);
  }
  const result = simulatePayment(input, stored.condition, parameterSet?.params);
  const usedParameters = result.bankEstimate ? parameterSet : null;

  const simulation = await db.simulation.create({
    data: {
      leadId: lead.id,
      unitId: unit.id,
      paymentMode: args.mode,
      salesConditionId: stored.id,
      referenceDate: dateFromIso(args.referenceDate),
      propertyValue: result.unitPrice,
      financedAmount: result.balanceAtKeys,
      requiredDownPayment: result.downPayment?.chosen ?? null,
      verdict: result.verdict,
      downPaymentPlan: jsonOrDbNull(result.plan),
      bankEstimate: jsonOrDbNull(result.bankEstimate),
      parametersVersion: usedParameters?.version ?? null,
      parameterSetId: usedParameters?.id ?? null,
      input: input as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
    },
  });
  return { simulation, result, salesConditionVersion: stored.version, parametersVersion: usedParameters?.version ?? null };
}

/**
 * Unidade usada na simulação de quem escolheu uma tipologia: a de menor preço disponível. É um
 * valor de referência (o lead não escolheu uma unidade específica) e a mensagem diz isso.
 */
export async function pickUnitForTypology(db: Db, typology: string, developmentId?: string): Promise<Unit | null> {
  return db.unit.findFirst({
    where: { typology, status: 'AVAILABLE', development: { active: true, ...(developmentId ? { id: developmentId } : {}) } },
    orderBy: [{ price: 'asc' }, { code: 'asc' }],
  });
}

/**
 * A simulação não pode ser feita com os dados/parâmetros atuais e repetir não resolve (dado
 * faltando, entrada inválida, sem parâmetros vigentes). Falha de banco ou de rede não entra aqui:
 * essa se repete pela fila.
 */
export function isSimulationDataError(err: unknown): boolean {
  return (
    err instanceof MissingSimulationDataError ||
    err instanceof InvalidSimulationInputError ||
    err instanceof ParametersNotInForceError ||
    err instanceof NoParametersInForceError ||
    err instanceof IllustrativeParametersRejectedError ||
    err instanceof NoSalesConditionInForceError ||
    err instanceof IllustrativeSalesConditionRejectedError ||
    err instanceof SalesConditionNotInForceError ||
    err instanceof PaymentModeNotOfferedError ||
    err instanceof InvalidPaymentInputError ||
    err instanceof InvalidSalesConditionError
  );
}
