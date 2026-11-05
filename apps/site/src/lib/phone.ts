/**
 * Celular brasileiro → E.164 só com dígitos (55 + DDD + 9 + 8 dígitos). Aceita máscara, +55 e zero
 * à esquerda. Telefone fixo não serve (o contato é por WhatsApp).
 */
export function normalizeBrPhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (!/^[1-9][1-9]9\d{8}$/.test(d)) return null;
  return `55${d}`;
}
