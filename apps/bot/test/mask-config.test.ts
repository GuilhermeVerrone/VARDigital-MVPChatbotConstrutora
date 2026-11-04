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
  const base = {
    WA_AKG_WEBHOOK_SECRET: 'x'.repeat(32),
    CHAT_HASH_SECRET: 'y'.repeat(32),
    BOT_DATABASE_URL: 'postgres://u:p@localhost:5432/bot',
    WA_AKG_API_KEY: 'key',
    ALLOWED_PHONES: '13981264295',
  };

  it('aplica defaults', () => {
    const c = loadConfig(base);
    expect(c.BOT_PORT).toBe(3100);
    expect(c.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(c.BOT_TLS_CERT_FILE).toBeUndefined();
  });
  it('retenção: 180 dias por padrão, 0 desliga, negativo é recusado', () => {
    expect(loadConfig(base).LEAD_RETENTION_DAYS).toBe(180);
    expect(loadConfig({ ...base, LEAD_RETENTION_DAYS: '0' }).LEAD_RETENTION_DAYS).toBe(0);
    expect(() => loadConfig({ ...base, LEAD_RETENTION_DAYS: '-1' })).toThrow(/configuração inválida/);
  });
  it('aplica defaults da fila e do WA-AKG', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ WA_AKG_SESSION_ID: 'piloto', INBOX_POLL_MS: 1000, INBOX_MAX_ATTEMPTS: 5 });
  });
  it('lê a lista de telefones permitidos e exige ao menos um', () => {
    expect(loadConfig({ ...base, ALLOWED_PHONES: '13981264295, +55 13 98126-4295' }).ALLOWED_PHONES).toHaveLength(2);
    expect(() => loadConfig({ ...base, ALLOWED_PHONES: ' , ' })).toThrow(/ALLOWED_PHONES/);
    expect(() => loadConfig({ ...base, ALLOWED_PHONES: 'abc' })).toThrow(/ALLOWED_PHONES/);
  });
  it('exige a API key do WA-AKG', () => {
    expect(() => loadConfig({ ...base, WA_AKG_API_KEY: '' })).toThrow(/WA_AKG_API_KEY/);
  });
  it('exige secret de webhook forte', () => {
    expect(() => loadConfig({ ...base, WA_AKG_WEBHOOK_SECRET: 'short' })).toThrow(/WA_AKG_WEBHOOK_SECRET/);
  });
  it('exige cert e key TLS juntos', () => {
    expect(() => loadConfig({ ...base, BOT_TLS_CERT_FILE: '/c.pem' })).toThrow(/TLS/);
  });
});
