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
export const LEAD_STATUS_LABEL = {
  NEW: 'Novo', IN_PROGRESS: 'Em conversa', SIMULATED: 'Simulou', HANDOFF: 'Com corretor (handoff)', DELIVERED: 'Entregue ao corretor', OPTED_OUT: 'Pediu para parar', CLOSED: 'Encerrado',
} as const;
export const SOURCE_LABEL = { SITE_FORM: 'Formulário do site', WHATSAPP: 'WhatsApp' } as const;
export const phoneBr = (digits: string | null): string => {
  if (!digits) return '—';
  const n = digits.replace(/^55/, '');
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}` : n.length === 10 ? `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}` : digits;
};
/** Rótulo das ações da auditoria de um lead (as que o bot e o painel gravam). */
export const LEAD_EVENT_LABEL: Record<string, string> = {
  status_changed: 'Status alterado', broker_assigned: 'Corretor atribuído', broker_notified: 'Corretor avisado', broker_updated: 'Corretor avisado da atualização',
  handoff_requested: 'Lead pediu um corretor', handoff_notified: 'Corretor recebeu o pedido', handoff_taken: 'Corretor assumiu a conversa', handoff_released: 'Conversa devolvida ao bot',
  optout: 'Lead pediu para parar', lgpd_request: 'Lead perguntou sobre seus dados', contact_declined: 'Lead negou o pedido do site',
};
