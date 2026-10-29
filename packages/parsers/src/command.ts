import { hasNegation, normalize } from './text';

export type CommandName = 'back' | 'correct' | 'exit' | 'human' | 'optout' | 'lgpd_request';

export interface CommandResult {
  command: CommandName;
  /** Para `correct`: o que o lead quer corrigir ("renda"), já normalizado. */
  target?: string;
}

const HUMAN_ROLE = '(?:corretor|corretora|atendente|humano|vendedor|vendedora|consultor|consultora|gerente|pessoa|alguem|gente)';

/**
 * Comandos globais da conversa: voltar, corrigir, sair, falar com corretor, parar de receber e
 * pedido de exclusão de dados. Só reconhece mensagens curtas e inequívocas; frase longa com a
 * palavra "corretor" não é pedido de handoff.
 */
export function parseCommand(text: string): CommandResult | null {
  const norm = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  const count = norm.split(' ').length;

  // LGPD: exclusão/acesso aos dados pessoais
  if (
    count <= 14 &&
    /\b(apag\w+|exclu\w+|delet\w+|remov\w+|elimin\w+|esquec\w+)\b/.test(norm) &&
    /\b(meus dados|meu cadastro|minhas informacoes|meus registros|dados pessoais|dados meus|meu numero|tudo sobre mim|lgpd)\b/.test(norm) &&
    !hasNegation(norm)
  ) {
    return { command: 'lgpd_request' };
  }
  if (count <= 6 && /^(?:quero |gostaria de |preciso )?(?:direito ao esquecimento|lgpd|titular dos dados)$/.test(norm)) {
    return { command: 'lgpd_request' };
  }

  // Parar de receber mensagens
  if (
    /^(?:parar|pare|para|stop|descadastrar|descadastra|cancelar (?:inscricao|cadastro|mensagens))$/.test(norm) ||
    (count <= 12 &&
      /\b(?:parar de (?:receber|me mandar|mandar|enviar)|para de (?:me )?(?:mandar|enviar|receber)|nao quero mais (?:receber|mensagens?)|me (?:remova|tire|descadastr\w+)|sair da lista|remover meu numero)\b/.test(norm))
  ) {
    return { command: 'optout' };
  }

  // Falar com humano
  if (!hasNegation(norm) && count <= 10) {
    const only = new RegExp(`^(?:um |o |a )?${HUMAN_ROLE}$`).test(norm);
    const verb = new RegExp(
      `\\b(?:falar|conversar|chamar|chama|passar|passa|transferir|transfere|encaminhar|quero|queria|preciso|prefiro|gostaria|atendimento|ligar|liga|contato|me atende)\\b.*\\b${HUMAN_ROLE}\\b`,
    ).test(norm);
    const reverse = new RegExp(`\\b${HUMAN_ROLE}\\b.*\\b(?:me ligar|me atender|entrar em contato|falar comigo|me chamar)\\b`).test(norm);
    if (only || verb || reverse) return { command: 'human' };
  }

  // Corrigir
  const correct =
    /^(?:eu )?(?:quero |queria |preciso |gostaria de |vou |posso |pode )*(?:corrigir|corrige|correcao|alterar|altera|mudar|muda|editar|refazer|trocar)(?: (?:a |o |as |os |minha |meu |minhas |meus |de |do |da |isso|essa|esse))*\s*(.*)$/.exec(norm);
  if (correct && count <= 9) {
    const target = (correct[1] ?? '').trim();
    return target ? { command: 'correct', target } : { command: 'correct' };
  }
  const wrong = /^(?:a |o |minha |meu )?(.{2,30}?) (?:esta|ta|estava|foi|ficou) (?:errad[oa]|incorret[oa]|trocad[oa])$/.exec(norm);
  if (wrong) return { command: 'correct', target: wrong[1]!.trim() };
  if (/^(?:errei|errado|esta errado|ta errado|nao e isso|nao era isso|digitei errado|escrevi errado)$/.test(norm)) {
    return { command: 'correct' };
  }

  // Voltar
  if (
    count <= 6 &&
    /^(?:(?:quero|queria|pode|preciso|vou|gostaria de|posso) )*(?:voltar|volta|retornar|retorna)(?: (?:uma |1 )?(?:etapa|pergunta|passo|atras|para tras|ao anterior|pra tras|anterior))?$/.test(norm)
  ) {
    return { command: 'back' };
  }
  if (/^(?:pergunta anterior|etapa anterior|anterior)$/.test(norm)) return { command: 'back' };

  // Sair
  if (/^(?:sair|sai|encerrar|encerra|finalizar|finaliza|tchau|ate mais|ate logo|cancelar|cancela|desistir|desisti|fechar)$/.test(norm)) {
    return { command: 'exit' };
  }
  if (count <= 7 && /^(?:quero |queria |vou |preciso |gostaria de |pode )*(?:sair|encerrar|finalizar|cancelar|desistir)(?: (?:da conversa|do atendimento|a conversa|o atendimento|aqui|tudo|isso|disso))?$/.test(norm)) {
    return { command: 'exit' };
  }
  return null;
}
