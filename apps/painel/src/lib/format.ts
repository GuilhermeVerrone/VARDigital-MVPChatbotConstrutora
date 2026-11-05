export const brl = (v: number, digits = 2): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits });
export const pctText = (ratio: number, digits = 2): string => `${(ratio * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;

/** "2029-12-15" → "15/12/2029". */
export function dateBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export const dateTimeBr = (d: Date): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(d);

export const MODE_LABEL = { A_VISTA: 'À vista', ENTRADA_A_VISTA: 'Entrada à vista', ENTRADA_PARCELADA: 'Entrada parcelada' } as const;
export const VERDICT_LABEL = { VIAVEL: 'Viável', VIAVEL_COM_AJUSTES: 'Viável com ajustes', INVIAVEL: 'Inviável' } as const;
export const UNIT_STATUS_LABEL = { AVAILABLE: 'Disponível', RESERVED: 'Reservada', SOLD: 'Vendida' } as const;
export const ROLE_LABEL = { ADMIN: 'Administrador', GERENTE: 'Gerente', CORRETOR: 'Corretor' } as const;
