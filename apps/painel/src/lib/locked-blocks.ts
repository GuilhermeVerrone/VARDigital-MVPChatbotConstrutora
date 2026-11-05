import { T } from '@mvp/conversation';
import { LEGAL_LINES } from '@mvp/presentation';

// Blocos legais do bot: o editor do fluxo mostra, mas não altera. Ficam no código porque dependem de
// revisão jurídica (consentimento LGPD, aviso de que a simulação não é crédito, exclusão de dados).

export interface LockedBlock {
  id: string;
  label: string;
  where: string;
  text: string;
}

export const LOCKED_BLOCKS: readonly LockedBlock[] = [
  { id: 'consent', label: 'Saudação e consentimento', where: 'Primeira mensagem de quem escreve pelo WhatsApp, antes de qualquer pergunta.', text: T.greetingAndConsent('{empreendimento}') },
  { id: 'legal', label: 'Aviso legal da simulação', where: 'Enviado junto com todo resultado de simulação.', text: LEGAL_LINES.join('\n\n') },
  { id: 'lgpd', label: 'Exclusão dos dados', where: 'Quando o lead pede para apagar os dados dele.', text: T.lgpdConfirm },
  { id: 'optout', label: 'Parar de receber mensagens', where: 'Quando o lead pede para parar.', text: T.optout },
];
