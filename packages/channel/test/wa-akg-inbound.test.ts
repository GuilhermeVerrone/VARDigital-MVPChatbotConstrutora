import { describe, expect, it } from 'vitest';
import { parseWaAkgWebhook, phoneFromJid } from '../src';

function envelope(data: Record<string, unknown>, event = 'message.received') {
  return { event, sessionId: 'piloto', timestamp: '2026-10-29T12:00:00.000Z', data };
}
const dm = {
  key: { id: '3EB0ABC', remoteJid: '5511987654321@s.whatsapp.net', fromMe: false },
  pushName: 'Maria',
  from: '5511987654321@s.whatsapp.net',
  isGroup: false,
  chatType: 'PERSONAL',
  type: 'TEXT',
  content: 'oi, quero simular',
};

describe('parseWaAkgWebhook', () => {
  it('normaliza texto de conversa individual', () => {
    expect(parseWaAkgWebhook(envelope(dm))).toEqual({
      ok: true,
      message: {
        channel: 'WHATSAPP',
        sessionId: 'piloto',
        externalId: '3EB0ABC',
        chatId: '5511987654321@s.whatsapp.net',
        phone: '5511987654321',
        pushName: 'Maria',
        type: 'text',
        text: 'oi, quero simular',
        receivedAt: '2026-10-29T12:00:00.000Z',
      },
    });
  });

  it('ignora eventos que não são message.received', () => {
    for (const event of ['message.sent', 'connection.update', 'test']) {
      expect(parseWaAkgWebhook(envelope(dm, event))).toEqual({ ok: false, reason: 'not_message_event' });
    }
  });

  it('ignora mensagem do próprio número (fromMe)', () => {
    const r = parseWaAkgWebhook(envelope({ ...dm, key: { ...dm.key, fromMe: true } }));
    expect(r).toEqual({ ok: false, reason: 'from_me' });
  });

  it('ignora grupos, por isGroup, chatType ou sufixo do JID', () => {
    const g = { ...dm, key: { ...dm.key, remoteJid: '120363@g.us' } };
    expect(parseWaAkgWebhook(envelope({ ...dm, isGroup: true }))).toEqual({ ok: false, reason: 'group' });
    expect(parseWaAkgWebhook(envelope({ ...dm, chatType: 'GROUP' }))).toEqual({ ok: false, reason: 'group' });
    expect(parseWaAkgWebhook(envelope({ ...g, isGroup: false, chatType: undefined }))).toEqual({ ok: false, reason: 'group' });
  });

  it('ignora status e canais', () => {
    expect(parseWaAkgWebhook(envelope({ ...dm, chatType: 'STATUS' }))).toEqual({ ok: false, reason: 'not_personal_chat' });
    expect(parseWaAkgWebhook(envelope({ ...dm, chatType: undefined, key: { ...dm.key, remoteJid: 'status@broadcast' } }))).toEqual({
      ok: false,
      reason: 'not_personal_chat',
    });
  });

  it('LID sem telefone conhecido: mantém o chatId para responder e phone = null', () => {
    const r = parseWaAkgWebhook(envelope({ ...dm, key: { ...dm.key, remoteJid: '123456789012345@lid' } }));
    expect(r).toMatchObject({ ok: true, message: { chatId: '123456789012345@lid', phone: null } });
  });

  it('áudio não tem texto; imagem usa a legenda', () => {
    expect(parseWaAkgWebhook(envelope({ ...dm, type: 'AUDIO', content: null }))).toMatchObject({
      ok: true,
      message: { type: 'audio', text: null },
    });
    expect(parseWaAkgWebhook(envelope({ ...dm, type: 'IMAGE', content: null, caption: 'minha renda' }))).toMatchObject({
      ok: true,
      message: { type: 'image', text: 'minha renda' },
    });
  });

  it('resposta de lista/botão vira interactive_response com o texto', () => {
    expect(parseWaAkgWebhook(envelope({ ...dm, type: 'LIST_RESPONSE', content: '2' }))).toMatchObject({
      ok: true,
      message: { type: 'interactive_response', text: '2' },
    });
  });

  it('tipo desconhecido não derruba', () => {
    expect(parseWaAkgWebhook(envelope({ ...dm, type: 'ALGO_NOVO', content: { x: 1 } }))).toMatchObject({
      ok: true,
      message: { type: 'unknown', text: null },
    });
  });

  it('payload sem key.id é inválido', () => {
    expect(parseWaAkgWebhook(envelope({ ...dm, key: { remoteJid: dm.key.remoteJid } }))).toEqual({ ok: false, reason: 'invalid_payload' });
    expect(parseWaAkgWebhook('lixo')).toEqual({ ok: false, reason: 'invalid_payload' });
  });
});

describe('phoneFromJid', () => {
  it('extrai dígitos de JID de telefone (com ou sem sufixo de dispositivo)', () => {
    expect(phoneFromJid('5511987654321@s.whatsapp.net')).toBe('5511987654321');
    expect(phoneFromJid('5511987654321:12@s.whatsapp.net')).toBe('5511987654321');
  });
  it('rejeita LID, grupo e lixo', () => {
    expect(phoneFromJid('123@lid')).toBeNull();
    expect(phoneFromJid('120363@g.us')).toBeNull();
    expect(phoneFromJid('abc@s.whatsapp.net')).toBeNull();
  });
});
