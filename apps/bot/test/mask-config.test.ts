import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { maskJid } from '../src/lib/mask';

describe('maskJid', () => {
  it('mantém só os 4 últimos dígitos e o domínio', () => {
    expect(maskJid('5511987654321@s.whatsapp.net')).toBe('*********4321@s.whatsapp.net');
    expect(maskJid('123456789012345@lid')).toBe('***********2345@lid');
    expect(maskJid('5511987654321')).toBe('*********4321');
  });
  it('não vaza valores curtos', () => {
    expect(maskJid('123')).toBe('****');
  });
  it('ignora valores não-string', () => {
    expect(maskJid(undefined)).toBeUndefined();
    expect(maskJid(42)).toBeUndefined();
  });
});

describe('loadConfig', () => {
  const base = { WA_AKG_WEBHOOK_SECRET: 'x'.repeat(32), BOT_DATABASE_URL: 'postgres://u:p@localhost:5432/bot' };

  it('aplica defaults', () => {
    const c = loadConfig(base);
    expect(c.BOT_PORT).toBe(3100);
    expect(c.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(c.BOT_TLS_CERT_FILE).toBeUndefined();
  });
  it('exige secret de webhook forte', () => {
    expect(() => loadConfig({ ...base, WA_AKG_WEBHOOK_SECRET: 'short' })).toThrow(/WA_AKG_WEBHOOK_SECRET/);
  });
  it('exige cert e key TLS juntos', () => {
    expect(() => loadConfig({ ...base, BOT_TLS_CERT_FILE: '/c.pem' })).toThrow(/TLS/);
  });
});
