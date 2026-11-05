import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LlmError, type LlmClient } from '@mvp/llm';
import { loadConfig } from '../src/config';
import { createLlmMonitor, setupLlm } from '../src/llm-provider';

const PROMPTS = join(__dirname, '../../../prompts');
const baseEnv = {
  WA_AKG_WEBHOOK_SECRET: 'x'.repeat(16),
  BOT_DATABASE_URL: 'postgresql://u:p@localhost:5432/bot',
  WA_AKG_API_KEY: 'k',
  ALLOWED_PHONES: '5511912345678',
  CHAT_HASH_SECRET: 'y'.repeat(16),
};
const cfg = (extra: Record<string, string> = {}) => loadConfig({ ...baseEnv, ...extra });

describe('configuração do LLM', () => {
  it('o padrão é a Anthropic, sem Ollama, com teto de chamadas por conversa', () => {
    const c = cfg();
    expect(c).toMatchObject({ LLM_PROVIDER: 'anthropic', LLM_MAX_CALLS_PER_CONVERSATION: 30, LLM_PROMPT_VERSION: 3 });
    expect(c.LLM_MODEL).toBeUndefined();
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('LLM_PROVIDER e LLM_MODEL escolhem o provedor e o modelo; vazio vira o padrão', () => {
    expect(cfg({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'qwen2.5:7b' })).toMatchObject({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'qwen2.5:7b' });
    const empty = cfg({ LLM_MODEL: '', ANTHROPIC_API_KEY: '' });
    expect(empty.LLM_MODEL).toBeUndefined();
    expect(empty.ANTHROPIC_API_KEY).toBeUndefined();
    expect(() => cfg({ LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
  });
});

describe('setupLlm', () => {
  it('Anthropic sem chave: o bot sobe sem LLM e o monitor acusa degradado', () => {
    const s = setupLlm(cfg(), PROMPTS);
    expect(s.llm).toBeUndefined();
    expect(s.disabledReason).toMatch(/ANTHROPIC_API_KEY/);
    expect(s.monitor.status()).toMatchObject({ ok: false, detail: expect.stringContaining('só parsers') });
  });

  it('Anthropic com chave: Haiku 5.5 por padrão e prompt v3', () => {
    const s = setupLlm(cfg({ ANTHROPIC_API_KEY: 'sk-ant-teste' }), PROMPTS);
    expect(s.llm?.llm.model).toBe('claude-haiku-5-5');
    expect(s.llm?.prompt).toMatchObject({ name: 'extraction', version: 3 });
    expect(s.monitor.status()).toMatchObject({ ok: true, detail: 'anthropic:claude-haiku-5-5' });
    expect(setupLlm(cfg({ ANTHROPIC_API_KEY: 'k', LLM_MODEL: 'claude-sonnet-5-5' }), PROMPTS).llm?.llm.model).toBe('claude-sonnet-5-5');
  });

  it('Ollama não precisa de chave e usa o modelo local por padrão', () => {
    const s = setupLlm(cfg({ LLM_PROVIDER: 'ollama', LLM_PROMPT_VERSION: '2' }), PROMPTS);
    expect(s.llm?.llm.model).toBe('qwen2.5:7b');
  });

  it('LLM_ENABLED=false e prompts ausentes desligam o LLM sem derrubar o bot', () => {
    expect(setupLlm(cfg({ LLM_ENABLED: 'false', ANTHROPIC_API_KEY: 'k' }), PROMPTS).llm).toBeUndefined();
    const noPrompts = setupLlm(cfg({ ANTHROPIC_API_KEY: 'k' }), undefined);
    expect(noPrompts.llm).toBeUndefined();
    expect(noPrompts.monitor.status().ok).toBe(false);
  });
});

describe('monitor do LLM', () => {
  const req = { system: 's', user: 'u', jsonSchema: {} };
  const client = (fail: () => boolean): LlmClient => ({
    model: 'm',
    async completeJson() {
      if (fail()) throw new LlmError('unavailable', 'API fora do ar');
      return { text: '{}', model: 'm', latencyMs: 1 };
    },
  });

  it('API fora do ar degrada, sem guardar conteúdo, e volta ao normal no primeiro acerto ou depois de 5 min', async () => {
    let t = 1_000_000;
    let down = false;
    const monitor = createLlmMonitor({ provider: 'anthropic', model: 'm', now: () => t });
    const wrapped = monitor.wrap(client(() => down));

    await wrapped.completeJson(req);
    expect(monitor.status().ok).toBe(true);

    down = true;
    await expect(wrapped.completeJson(req)).rejects.toBeInstanceOf(LlmError);
    const degraded = monitor.status();
    expect(degraded).toMatchObject({ ok: false, detail: expect.stringContaining('unavailable') });
    expect(degraded.detail).not.toContain('API fora do ar');

    t += 6 * 60_000;
    expect(monitor.status().ok).toBe(true);

    await expect(wrapped.completeJson(req)).rejects.toBeInstanceOf(LlmError);
    down = false;
    await wrapped.completeJson(req);
    expect(monitor.status().ok).toBe(true);
  });
});
