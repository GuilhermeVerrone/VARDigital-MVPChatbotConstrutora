// Valores monetários em reais (number). O cálculo interno não arredonda; só a saída é
// arredondada para centavos. `toPrecision(15)` descarta o ruído binário (ex.: 1.005 * 100
// = 100.49999…) antes de arredondar.

function cleanCents(value: number): number {
  return Number((value * 100).toPrecision(15));
}

/** Arredonda para centavos, meio para longe de zero (como ARRED/ROUND da planilha). */
export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(cleanCents(value)))) / 100;
}

/** Trunca para centavos (para tetos: nunca ultrapassar o limite). */
export function floorCents(value: number): number {
  return Math.floor(cleanCents(value)) / 100;
}

export function toCents(value: number): number {
  return Math.round(cleanCents(value));
}

export function fromCents(cents: number): number {
  return cents / 100;
}
