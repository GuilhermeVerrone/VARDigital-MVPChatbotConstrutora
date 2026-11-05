import type { Db } from './client';
import type { Prisma } from './generated/prisma/client';
import type { ChatIdentity } from './conversations';

// Lead do formulário do site (V2, discovery §3): o site grava o lead, o consentimento WEB e o job
// FIRST_CONTACT. A conversa no WhatsApp só nasce quando o lead responde (ou quando o worker envia a
// 1ª mensagem). O casamento é pelo telefone ou pelo código curto (ELV-4821), que cobre a resposta
// vinda de um endereço @lid, onde o telefone não aparece.

const CODE_PREFIX = 'ELV-';
const CODE_RE = /\bELV-?\s?([0-9A-Z]{4,6})\b/i;

/** Normaliza para o formato gravado ("elv 4821" → "ELV-4821"). */
export const formatContactCode = (digits: string): string => `${CODE_PREFIX}${digits.toUpperCase()}`;

/** Acha um código ELV-xxxx no texto do lead (ex.: no texto pronto do botão wa.me). */
export function extractContactCode(text: string): string | null {
  const m = CODE_RE.exec(text);
  return m ? formatContactCode(m[1]!) : null;
}

function randomCode(length: number): string {
  let n = '';
  for (let i = 0; i < length; i++) n += Math.floor(Math.random() * 10);
  return formatContactCode(n);
}

/** Dá ao lead um código curto livre. Idempotente: quem já tem código o mantém. */
export async function assignContactCode(db: Pick<Db, 'lead'>, leadId: string): Promise<string> {
  const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { contactCode: true } });
  if (lead.contactCode) return lead.contactCode;
  // 4 dígitos bastam para o piloto; se a faixa lotar, passa a 5 e 6.
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = randomCode(4 + Math.floor(attempt / 10));
    if (await db.lead.findUnique({ where: { contactCode: code }, select: { id: true } })) continue;
    try {
      await db.lead.update({ where: { id: leadId }, data: { contactCode: code } });
      return code;
    } catch {
      // corrida com outro lead pegando o mesmo código: sorteia de novo
    }
  }
  throw new Error('não consegui gerar um código de contato livre');
}

export interface FormLead {
  leadId: string;
  name: string | null;
  /** E.164 só com dígitos. */
  phone: string | null;
  email: string | null;
  developmentId: string | null;
  contactCode: string | null;
  createdAt: Date;
}

/**
 * O lead do formulário que ainda não tem conversa e pode ser atendido: veio do site, tem
 * consentimento válido (o do próprio formulário) e não recusou nem pediu para parar. Pelo endereço
 * do chat, pelo telefone ou pelo código dito no texto.
 */
export async function findFormLead(db: Pick<Db, 'lead'>, who: Pick<ChatIdentity, 'chatId' | 'phone'>, code: string | null): Promise<FormLead | null> {
  const or: Prisma.LeadWhereInput[] = [{ channelJid: who.chatId }];
  if (who.phone) or.push({ phone: who.phone });
  if (code) or.push({ contactCode: code });
  const lead = await db.lead.findFirst({
    where: {
      source: 'SITE_FORM',
      status: { in: ['NEW', 'IN_PROGRESS'] },
      conversations: { none: {} },
      consents: { some: { revokedAt: null } },
      OR: or,
    },
    orderBy: { createdAt: 'asc' },
  });
  return lead
    ? {
        leadId: lead.id, name: lead.name, phone: lead.phone, email: lead.email, developmentId: lead.developmentId,
        contactCode: lead.contactCode, createdAt: lead.createdAt,
      }
    : null;
}

export interface StartFormConversationArgs {
  leadId: string;
  /** Endereço do chat de quem respondeu; grava no lead para as próximas mensagens casarem direto. */
  chatId: string;
  state: string;
  context: Prisma.InputJsonValue;
  history: Prisma.InputJsonValue;
  /** true = o lead escreveu primeiro com o código (já confirma o pedido, sem a pergunta do double opt-in). */
  confirmed: boolean;
  at: Date;
}

/** Abre a conversa do lead do formulário. Se já existe uma, devolve a existente (idempotente). */
export async function startFormConversation(db: Db, a: StartFormConversationArgs): Promise<{ conversationId: string; created: boolean }> {
  return db.$transaction(async (tx) => {
    const existing = await tx.conversation.findFirst({ where: { leadId: a.leadId }, orderBy: { startedAt: 'desc' } });
    if (existing) return { conversationId: existing.id, created: false };
    const owner = await tx.lead.findUnique({ where: { channelJid: a.chatId }, select: { id: true } });
    await tx.lead.update({
      where: { id: a.leadId },
      data: {
        status: 'IN_PROGRESS',
        // O endereço é único: se outro lead já o usa (a mesma pessoa chegou antes pelo chat), não sobrescreve.
        ...(!owner || owner.id === a.leadId ? { channelJid: a.chatId } : {}),
        ...(a.confirmed ? { contactConfirmedAt: a.at } : {}),
      },
    });
    const conv = await tx.conversation.create({ data: { leadId: a.leadId, channel: 'WHATSAPP', state: a.state, context: a.context, history: a.history } });
    return { conversationId: conv.id, created: true };
  });
}

/**
 * Silêncio no double opt-in: leads do formulário que nunca confirmaram e passaram do prazo (48 h)
 * são encerrados e nada mais é enviado a eles. Devolve quantos foram encerrados.
 */
export async function closeUnconfirmedFormLeads(db: Db, now: Date, maxAgeMs = 48 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const stale = await db.lead.findMany({
    where: {
      source: 'SITE_FORM', contactConfirmedAt: null, status: { in: ['NEW', 'IN_PROGRESS'] }, createdAt: { lt: cutoff },
      OR: [{ conversations: { none: {} } }, { conversations: { every: { state: 'CONTACT_CONFIRM' } } }],
    },
    select: { id: true },
  });
  for (const { id } of stale) {
    await db.$transaction([
      db.lead.update({ where: { id }, data: { status: 'CLOSED' } }),
      db.conversation.updateMany({ where: { leadId: id, state: 'CONTACT_CONFIRM' }, data: { state: 'OPTED_OUT' } }),
      db.auditLog.create({ data: { actor: 'bot', entity: 'lead', entityId: id, action: 'contact_unconfirmed_closed' } }),
    ]);
  }
  return stale.length;
}
