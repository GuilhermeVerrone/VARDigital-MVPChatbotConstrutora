export const brl = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "2029-12-15" → "dezembro de 2029". */
export function deliveryLabel(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} de ${y}`;
}

export const areaLabel = (min: number, max: number): string => {
  const f = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return min === max ? `${f(min)} m²` : `${f(min)} a ${f(max)} m²`;
};
