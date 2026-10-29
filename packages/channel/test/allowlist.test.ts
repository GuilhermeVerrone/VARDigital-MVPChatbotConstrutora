import { describe, expect, it, vi } from 'vitest';
import { canonicalPhone, createPhoneAllowlist, restrictChannel, type ChannelAdapter } from '../src';

describe('allowlist', () => {
  const list = createPhoneAllowlist(['13981264295']);

  it('aceita o número em qualquer formato, inclusive o JID antigo sem o 9', () => {
    for (const v of ['13981264295', '5513981264295', '+55 (13) 98126-4295', '5513981264295@s.whatsapp.net', '551381264295@s.whatsapp.net', '5513981264295:7@s.whatsapp.net'])
      expect(list.isAllowed(v), v).toBe(true);
  });

  it('recusa outros números, LID, grupo e vazio', () => {
    for (const v of ['5511987654321@s.whatsapp.net', '5513981264296', '5513981264295@lid', '1203@g.us', '', '981264295'])
      expect(list.isAllowed(v), v).toBe(false);
  });

  it('canonicalPhone normaliza DDI e nono dígito', () => {
    expect(canonicalPhone('5513981264295')).toBe('1381264295');
    expect(canonicalPhone('13981264295')).toBe('1381264295');
    expect(canonicalPhone('551381264295')).toBe('1381264295');
  });

  it('lista vazia é erro (falha fechada)', () => {
    expect(() => createPhoneAllowlist([])).toThrow();
    expect(() => createPhoneAllowlist(['abc'])).toThrow();
  });

  it('restrictChannel bloqueia todo envio fora da lista, sem chamar o canal, e como erro permanente', async () => {
    const inner = { sendText: vi.fn(), sendList: vi.fn(), sendDocument: vi.fn(), setPresence: vi.fn(), markRead: vi.fn() };
    const ch = restrictChannel(inner as unknown as ChannelAdapter, list);
    const other = '5511987654321@s.whatsapp.net';
    const calls = [
      () => ch.sendText(other, 'x'),
      () => ch.sendList(other, { title: 't', options: [] }),
      () => ch.sendDocument(other, { data: new Uint8Array(), fileName: 'a.pdf', mimeType: 'application/pdf' }),
      () => ch.setPresence(other, 'composing'),
      () => ch.markRead(other, ['1']),
    ];
    for (const c of calls) expect(() => c()).toThrow(expect.objectContaining({ retryable: false }));
    Object.values(inner).forEach((f) => expect(f).not.toHaveBeenCalled());

    await ch.sendText('5513981264295@s.whatsapp.net', 'ok');
    expect(inner.sendText).toHaveBeenCalledOnce();
  });
});
