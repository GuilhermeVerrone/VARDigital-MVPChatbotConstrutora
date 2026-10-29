/**
 * Contrato do canal (spec §9.1). O orquestrador só conhece estas interfaces: trocar o WA-AKG
 * pela API oficial da Meta (`CloudApiAdapter`) não deve mexer no fluxo.
 */

export type InboundType =
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'interactive_response'
  | 'unknown';

/** Mensagem recebida, já normalizada (independente do formato do canal). */
export interface InboundMessage {
  channel: 'WHATSAPP';
  sessionId: string;
  /** Id da mensagem no canal (`key.id`): chave de idempotência. */
  externalId: string;
  /** Endereço da conversa; é para onde as respostas vão. */
  chatId: string;
  /** Telefone só com dígitos (E.164 sem "+"), ou null quando o canal só informou um LID. */
  phone: string | null;
  pushName: string | null;
  type: InboundType;
  /** Texto da mensagem (ou legenda). null para tipos sem texto. */
  text: string | null;
  /** ISO 8601 do evento (do envelope do webhook). */
  receivedAt: string;
}

export type IgnoreReason = 'not_message_event' | 'from_me' | 'group' | 'not_personal_chat' | 'invalid_payload';

export type ParsedWebhook = { ok: true; message: InboundMessage } | { ok: false; reason: IgnoreReason };

export interface OptionItem {
  title: string;
  description?: string;
}

export interface SentMessage {
  /** Id atribuído pelo canal, quando devolvido. */
  externalId: string | null;
}

export type Presence = 'composing' | 'paused' | 'available';

export interface ChannelAdapter {
  sendText(chatId: string, text: string): Promise<SentMessage>;
  /** Lista de opções numeradas ("1. …"); o canal escolhe o formato. */
  sendList(chatId: string, args: { title: string; options: OptionItem[]; footer?: string }): Promise<SentMessage>;
  sendDocument(
    chatId: string,
    args: { data: Uint8Array; fileName: string; mimeType: string; caption?: string },
  ): Promise<SentMessage>;
  setPresence(chatId: string, presence: Presence): Promise<void>;
  markRead(chatId: string, messageIds: string[]): Promise<void>;
}

/** Falha de envio. `retryable` diz se vale tentar de novo (rede, 5xx, 429) ou não (4xx). */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}
