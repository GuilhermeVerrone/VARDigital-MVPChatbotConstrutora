// Comandos que o corretor manda ao bot pelo WhatsApp (Fase 7): assumir e devolver um atendimento em
// handoff, e listar os que estão em aberto. Só são reconhecidos quando o remetente é um corretor
// cadastrado; qualquer outra mensagem dele segue o fluxo normal (assim o número de teste do piloto
// continua podendo conversar como lead).

export type BrokerCommand =
  | { kind: 'take'; code: string }
  | { kind: 'release'; code: string }
  | { kind: 'list' };

export function parseBrokerCommand(text: string): BrokerCommand | null {
  const t = text.trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
  const withCode = /^(assumir|assumo|devolver|devolvo)\s+\*?([a-z0-9]{6})\*?$/i.exec(t);
  if (withCode) {
    const code = withCode[2]!.toUpperCase();
    return /^assum/i.test(withCode[1]!) ? { kind: 'take', code } : { kind: 'release', code };
  }
  if (/^(pendentes|atendimentos|meus atendimentos)$/i.test(t)) return { kind: 'list' };
  return null;
}

export const B = {
  notFound: 'Não encontrei nenhum atendimento com esse código. Confira o código do aviso ou mande *pendentes* para ver os seus.',
  notWaiting: 'Esse atendimento não está mais aguardando corretor.',
  takenByOther: (name: string) => `Esse atendimento já foi assumido por ${name}.`,
  notYours: 'Você não assumiu esse atendimento, então não posso devolvê-lo. Para assumir, mande *assumir* e o código.',
  taken: (code: string, name: string | null, phone: string | null) =>
    [
      `Pronto, você assumiu o atendimento *${code}*${name ? ` de *${name}*` : ''}.`,
      phone ? `Telefone: ${phone}` : 'O lead não informou telefone: responda pelo próprio WhatsApp dele.',
      'O bot não vai mais responder a esse lead.',
      `Quando terminar, mande *devolver ${code}* para o bot voltar a atendê-lo.`,
    ].join('\n'),
  alreadyYours: (code: string) => `Você já assumiu o atendimento *${code}*. Para devolvê-lo ao bot, mande *devolver ${code}*.`,
  released: (code: string) => `Devolvi o atendimento *${code}* ao bot. Ele vai continuar a conversa com o lead.`,
  releasedNoChat: (code: string) => `Devolvi o atendimento *${code}*, mas não tenho o endereço do lead para avisá-lo. Ele volta a ser atendido na próxima mensagem.`,
  noOpen: 'Você não tem atendimentos em aberto.',
  openHeader: 'Seus atendimentos em aberto:',
  openLine: (code: string, name: string | null, mine: boolean, since: string | null) =>
    `• *${code}* — ${name ?? 'sem nome'} (${mine ? 'assumido por você' : 'aguardando você'}${since ? `, desde ${since}` : ''})`,
  erasureNotice: (name: string | null, phone: string | null) =>
    [
      '⚠️ *Pedido de exclusão de dados (LGPD)*',
      `${name ? `*${name}*` : 'Um lead'}${phone ? ` (${phone})` : ''} pediu a exclusão dos dados dele.`,
      'Apague as mensagens, o card e o PDF desse lead que você recebeu, tire o contato das suas listas e não o procure mais.',
    ].join('\n'),
};
