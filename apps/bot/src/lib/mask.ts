/**
 * Mascara telefone/JID para logs (spec §7.3): mantém só os 4 últimos dígitos.
 * "5511987654321@s.whatsapp.net" → "*********4321@s.whatsapp.net"
 */
export function maskJid(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const at = value.indexOf('@');
  const user = at === -1 ? value : value.slice(0, at);
  const domain = at === -1 ? '' : value.slice(at);
  const visible = user.length > 4 ? user.slice(-4) : '';
  return '*'.repeat(Math.max(user.length - visible.length, 4)) + visible + domain;
}
