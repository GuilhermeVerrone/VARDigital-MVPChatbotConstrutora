export type RateConvention = 'NOMINAL' | 'EFFECTIVE';

export interface Rates {
  monthly: number;
  nominalAnnual: number;
  effectiveAnnual: number;
}

/**
 * NOMINAL: taxa anual capitalizada mensalmente (mensal = anual / 12), como os bancos
 * costumam anunciar ("8,16% a.a. nominal"). EFFECTIVE: (1 + anual)^(1/12) − 1.
 */
export function toRates(annualRate: number, convention: RateConvention): Rates {
  const monthly = convention === 'NOMINAL' ? annualRate / 12 : Math.pow(1 + annualRate, 1 / 12) - 1;
  return {
    monthly,
    nominalAnnual: monthly * 12,
    effectiveAnnual: Math.pow(1 + monthly, 12) - 1,
  };
}
