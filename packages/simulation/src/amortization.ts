import { floorCents, roundCents } from './money';

export type AmortizationSystem = 'SAC' | 'PRICE';

/** Encargos mensais que incidem sobre a parcela (spec §4.4, RF-20). */
export interface MonthlyCharges {
  /** Seguro MIP: taxa mensal sobre o saldo devedor antes do pagamento. */
  mipMonthlyRate: number;
  /** Seguro DFI: valor mensal fixo (taxa × valor do imóvel). */
  dfiMonthly: number;
  /** Taxa de administração + tarifas mensais fixas. */
  feesMonthly: number;
}

export const NO_CHARGES: MonthlyCharges = { mipMonthlyRate: 0, dfiMonthly: 0, feesMonthly: 0 };

export interface Installment {
  number: number;
  amortization: number;
  interest: number;
  mip: number;
  dfi: number;
  fees: number;
  total: number;
  balanceAfter: number;
}

export interface ScheduleTotals {
  paid: number;
  amortization: number;
  interest: number;
  insurance: number;
  fees: number;
}

export interface Schedule {
  system: AmortizationSystem;
  principal: number;
  monthlyRate: number;
  termMonths: number;
  installments: Installment[];
  totals: ScheduleTotals;
}

/** Fator da Price: PMT = PV × fator. Com taxa zero, PV / n. */
export function priceFactor(monthlyRate: number, termMonths: number): number {
  if (monthlyRate === 0) return 1 / termMonths;
  const growth = Math.pow(1 + monthlyRate, termMonths);
  return (monthlyRate * growth) / (growth - 1);
}

/** PMT = PV × [i(1+i)^n] / [(1+i)^n − 1], sem arredondar. */
export function pricePayment(principal: number, monthlyRate: number, termMonths: number): number {
  return principal * priceFactor(monthlyRate, termMonths);
}

function assertTerm(termMonths: number): void {
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new RangeError(`prazo inválido: ${termMonths}`);
  }
}

/**
 * Cronograma completo. Cada componente é calculado sem arredondamento a partir do saldo
 * sem arredondamento; os valores de saída são arredondados para centavos (os totais são a
 * soma dos valores sem arredondar, arredondada no fim).
 */
export function buildSchedule(
  system: AmortizationSystem,
  principal: number,
  monthlyRate: number,
  termMonths: number,
  charges: MonthlyCharges = NO_CHARGES,
): Schedule {
  assertTerm(termMonths);
  if (!(principal > 0)) throw new RangeError(`valor financiado inválido: ${principal}`);

  const pmt = system === 'PRICE' ? pricePayment(principal, monthlyRate, termMonths) : 0;
  const sacAmortization = principal / termMonths;
  const sum = { paid: 0, amortization: 0, interest: 0, insurance: 0, fees: 0 };
  const installments: Installment[] = [];
  let balance = principal;

  for (let k = 1; k <= termMonths; k++) {
    const interest = balance * monthlyRate;
    // Última parcela quita o saldo exato (elimina resíduo de ponto flutuante).
    const amortization =
      k === termMonths ? balance : system === 'SAC' ? sacAmortization : pmt - interest;
    const mip = balance * charges.mipMonthlyRate;
    const total = amortization + interest + mip + charges.dfiMonthly + charges.feesMonthly;
    balance -= amortization;

    sum.paid += total;
    sum.amortization += amortization;
    sum.interest += interest;
    sum.insurance += mip + charges.dfiMonthly;
    sum.fees += charges.feesMonthly;
    installments.push({
      number: k,
      amortization: roundCents(amortization),
      interest: roundCents(interest),
      mip: roundCents(mip),
      dfi: roundCents(charges.dfiMonthly),
      fees: roundCents(charges.feesMonthly),
      total: roundCents(total),
      balanceAfter: roundCents(Math.max(balance, 0)),
    });
  }

  return {
    system,
    principal,
    monthlyRate,
    termMonths,
    installments,
    totals: {
      paid: roundCents(sum.paid),
      amortization: roundCents(sum.amortization),
      interest: roundCents(sum.interest),
      insurance: roundCents(sum.insurance),
      fees: roundCents(sum.fees),
    },
  };
}

/**
 * Maior valor financiado cuja 1ª parcela (com seguros e taxas) cabe em `maxInstallment`.
 * A 1ª parcela é a maior nos dois sistemas (SAC decrescente; na Price o MIP cai com o saldo),
 * e é linear no valor financiado: total₁ = PV × (fator + MIP) + DFI + taxas.
 * Resultado truncado em centavos para nunca passar do limite.
 */
export function maxPrincipalForInstallment(
  system: AmortizationSystem,
  maxInstallment: number,
  monthlyRate: number,
  termMonths: number,
  charges: MonthlyCharges = NO_CHARGES,
): number {
  assertTerm(termMonths);
  const available = maxInstallment - charges.dfiMonthly - charges.feesMonthly;
  if (available <= 0) return 0;
  const factor =
    (system === 'PRICE' ? priceFactor(monthlyRate, termMonths) : 1 / termMonths + monthlyRate) +
    charges.mipMonthlyRate;
  return floorCents(available / factor);
}
