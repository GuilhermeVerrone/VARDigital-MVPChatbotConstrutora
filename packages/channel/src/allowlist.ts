import { ChannelError, type ChannelAdapter } from './types';
import { phoneFromJid } from './wa-akg-inbound';

/**
 * Chave canônica de um telefone brasileiro, para comparar "5513981264295", "13981264295" e o JID
 * antigo sem o 9 ("551381264295"): sem o 55 e sem o 9 depois do DDD. Outros formatos: só dígitos.
 */
export function canonicalPhone(value: string): string {
  let d = value.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
}

export interface PhoneAllowlist {
  /** JID ou telefone. LID (sem telefone conhecido) nunca é permitido: não dá para verificar. */
  isAllowed(jidOrPhone: string): boolean;
}

/** Valor de ALLOWED_PHONES que abre o bot a qualquer número (produção). Opt-in explícito: o padrão é a lista. */
export const OPEN_ALLOWLIST = '*';

/** Modo aberto: qualquer conversa individual (telefone ou JID/LID). Grupos, listas de transmissão e canais seguem recusados. */
const openAllowlist: PhoneAllowlist = {
  isAllowed(jidOrPhone) {
    const v = jidOrPhone.trim();
    if (v.includes('@')) return !/@(g\.us|broadcast|newsletter)$/.test(v) && v.split('@')[0] !== '';
    return /^\+?[\d\s()-]{8,20}$/.test(v);
  },
};

export function createPhoneAllowlist(phones: string[]): PhoneAllowlist {
  if (phones.some((p) => p.trim() === OPEN_ALLOWLIST)) return openAllowlist;
  const allowed = new Set(phones.map(canonicalPhone).filter((p) => p !== ''));
  if (allowed.size === 0) throw new Error('lista de telefones permitidos vazia');
  return {
    isAllowed(jidOrPhone) {
      const phone = jidOrPhone.includes('@') ? phoneFromJid(jidOrPhone) : jidOrPhone;
      return phone !== null && allowed.has(canonicalPhone(phone));
    },
  };
}

/** Defesa em profundidade: mesmo que algo no fluxo erre o destino, nada sai para fora da lista. */
export function restrictChannel(inner: ChannelAdapter, allowlist: PhoneAllowlist): ChannelAdapter {
  const guard = (chatId: string) => {
    if (!allowlist.isAllowed(chatId)) throw new ChannelError('destino fora da lista de permitidos; envio bloqueado', false);
  };
  return {
    sendText: (c, ...a) => (guard(c), inner.sendText(c, ...a)),
    sendList: (c, ...a) => (guard(c), inner.sendList(c, ...a)),
    sendDocument: (c, ...a) => (guard(c), inner.sendDocument(c, ...a)),
    setPresence: (c, ...a) => (guard(c), inner.setPresence(c, ...a)),
    markRead: (c, ...a) => (guard(c), inner.markRead(c, ...a)),
  };
}
