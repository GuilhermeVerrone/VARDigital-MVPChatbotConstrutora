import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AnthropicClient,
  createCallBudget,
  generateStructured,
  interpretReply,
  loadAnthropicConfig,
  LlmError,
  loadPrompt,
  maskPii,
  nameTerms,
  toAnthropicSchema,
  toJsonSchema,
  type FieldDef,
  type LlmClient,
  type StepContext,
} from '../src';

const prompt = loadPrompt(join(__dirname, '../../../prompts'), 'extraction', 2);

function messageBody(text: string, over: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 30 },
    ...over,
  };
}

/** fetch falso que guarda o corpo de cada requisição e responde em sequência. */
function fakeFetch(...replies: (Record<string, unknown> | { status: number })[]) {
  const bodies: string[] = [];
  let n = 0;
  const impl: typeof fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ''));
    const r = replies[Math.min(n++, replies.length - 1)]!;
    const status = 'status' in r ? (r.status as number) : 200;
    const body = 'status' in r ? { type: 'error', error: { type: 'api_error', message: 'segredo da requisição' } } : r;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } });
  };
  return { impl, bodies };
}

const client = (f: ReturnType<typeof fakeFetch>, extra = {}) =>
  new AnthropicClient({ apiKey: 'sk-ant-teste', fetch: f.impl, maxRetries: 0, timeoutMs: 2000, ...extra });

const req = { system: 'sistema', user: 'usuário', jsonSchema: { type: 'object', properties: { a: { type: 'number' } } } };

describe('AnthropicClient', () => {
  it('usa Haiku 5.5 por padrão, pede JSON Schema sem raciocínio e devolve texto e tokens', async () => {
    const f = fakeFetch(messageBody('{"a":1}'));
    const c = client(f);
    expect(c.model).toBe('claude-haiku-5-5');
    const res = await c.completeJson(req);
    expect(res).toMatchObject({ text: '{"a":1}', model: 'claude-haiku-5-5', promptTokens: 120, completionTokens: 30 });
    const sent = JSON.parse(f.bodies[0]!);
    expect(sent).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'sistema',
      messages: [{ role: 'user', content: 'usuário' }],
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(sent).not.toHaveProperty('temperature');
  });

  it('o modelo vem de LLM_MODEL e a chave só do ambiente', () => {
    expect(loadAnthropicConfig({})).toBeNull();
    expect(loadAnthropicConfig({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
    expect(loadAnthropicConfig({ ANTHROPIC_API_KEY: 'k', LLM_MODEL: 'claude-sonnet-5-5', LLM_TIMEOUT_MS: '9000' })).toEqual({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
      timeoutMs: 9000,
    });
    expect(loadAnthropicConfig({ ANTHROPIC_API_KEY: 'k', LLM_MODEL: 'qwen2.5:7b' })?.model).toBe('qwen2.5:7b');
  });

  it('erros viram LlmError tipado, sem repetir o conteúdo da requisição', async () => {
    const bad = await client(fakeFetch({ status: 400 })).completeJson(req).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(LlmError);
    expect(bad).toMatchObject({ kind: 'bad_status' });
    expect((bad as Error).message).not.toContain('segredo');

    const auth = await client(fakeFetch({ status: 401 })).completeJson(req).catch((e: unknown) => e);
    expect(auth).toMatchObject({ kind: 'bad_status' });

    const down = await client({ impl: async () => { throw new TypeError('fetch failed'); }, bodies: [] }).completeJson(req).catch((e: unknown) => e);
    expect(down).toMatchObject({ kind: 'unavailable' });
  });

  it('timeout vira kind "timeout"', async () => {
    const slow: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    const err = await new AnthropicClient({ apiKey: 'k', fetch: slow, maxRetries: 0, timeoutMs: 50 }).completeJson(req).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'timeout' });
  });

  it('nova tentativa do SDK em 5xx: a segunda resposta vale', async () => {
    const f = fakeFetch({ status: 529 }, messageBody('{"a":2}'));
    const res = await client(f, { maxRetries: 1 }).completeJson(req);
    expect(res.text).toBe('{"a":2}');
    expect(f.bodies).toHaveLength(2);
  });

  it('recusa e resposta vazia viram erro "empty"', async () => {
    expect(await client(fakeFetch(messageBody('', { content: [], stop_reason: 'refusal' }))).completeJson(req).catch((e: unknown) => e)).toMatchObject({ kind: 'empty' });
    expect(await client(fakeFetch(messageBody(''))).completeJson(req).catch((e: unknown) => e)).toMatchObject({ kind: 'empty' });
  });

  it('o schema enviado perde as faixas que a API não aceita, mas mantém as chaves e fecha os objetos', () => {
    const schema = toAnthropicSchema(
      toJsonSchema(z.object({ intent: z.enum(['answer', 'faq']), fields: z.object({ renda: z.number().min(0).max(5).nullable() }), confidence: z.number().min(0).max(1) })),
    );
    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/minimum|maximum/);
    expect(text).toContain('"enum":["answer","faq"]');
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['intent', 'fields', 'confidence'] });
  });

  it('generateStructured valida com Zod mesmo com a faixa removida do schema', async () => {
    const f = fakeFetch(messageBody('{"c":7}'), messageBody('{"c":0.5}'));
    const schema = z.object({ c: z.number().min(0).max(1) });
    const out = await generateStructured(client(f), schema, { system: 's', user: 'u' });
    expect(out).toMatchObject({ value: { c: 0.5 }, attempts: 2 });
  });
});

describe('minimização de dados (D13)', () => {
  const income: FieldDef = { key: 'renda_bruta', kind: 'money' };
  const ctx: StepContext = { state: 'PERFIL', question: 'Qual a renda bruta mensal? Confirme o número (11) 91234-5678', fields: [income] };
  const answer = JSON.stringify({ intent: 'answer', fields: { renda_bruta: 6000 }, confidence: 0.9 });

  it('o corpo enviado à API não tem nome, telefone nem e-mail', async () => {
    const f = fakeFetch(messageBody(answer));
    const text = 'Sou Maria Souza Lima, meu zap é (11) 98888-7777, e-mail maria.lima@exemplo.com, ganho tipo 5 ou 6 mil mais pra 6, cpf 123.456.789-09';
    const r = await interpretReply(text, ctx, { llm: client(f), prompt, today: '2026-11-05', redactTerms: nameTerms('Maria Souza Lima') });
    expect(r).toMatchObject({ kind: 'answer', fields: { renda_bruta: 6000 }, source: 'llm' });

    const body = f.bodies[0]!;
    for (const secret of ['Maria', 'Souza', 'Lima', 'maria.lima', 'exemplo.com', '98888', '91234', '123.456.789', 'sk-ant-teste']) {
      expect(body, secret).not.toContain(secret);
    }
    // o que a tarefa precisa continua lá: texto da resposta e definição do campo
    expect(body).toContain('tipo 5 ou 6 mil');
    expect(body).toContain('renda_bruta');
  });

  it('campos de nome, telefone e e-mail nunca vão ao LLM: parser ou repergunta', async () => {
    const f = fakeFetch(messageBody(JSON.stringify({ intent: 'answer', fields: { nome: 'Maria Souza' }, confidence: 1 })));
    const nameCtx: StepContext = { state: 'IDENTIFICACAO', question: 'Qual o seu nome completo?', fields: [{ key: 'nome', kind: 'name' }] };
    expect(await interpretReply('hm, pode me chamar de ??', nameCtx, { llm: client(f), prompt })).toEqual({ kind: 'reask', reason: 'unparsed' });
    for (const kind of ['phone', 'email'] as const) {
      const c: StepContext = { state: 'X', question: 'q', fields: [{ key: 'k', kind }] };
      expect(await interpretReply('não sei bem', c, { llm: client(f), prompt })).toEqual({ kind: 'reask', reason: 'unparsed' });
    }
    expect(f.bodies).toHaveLength(0);
  });

  it('maskPii não estraga valores em reais', () => {
    expect(maskPii('ganho 7500,50 e devo 1.200 por mês, entrada de R$ 80.000')).toBe('ganho 7500,50 e devo 1.200 por mês, entrada de R$ 80.000');
    expect(maskPii('liga 11 91234 5678 ou +55 (11) 3333-4444')).toBe('liga [número] ou [número]');
    expect(maskPii('falar com o JOÃO silva', nameTerms('João da Silva'))).toBe('falar com o [nome] [nome]');
  });
});

describe('limite de chamadas por conversa', () => {
  const stub = (): LlmClient & { calls: number } => {
    const c = {
      model: 'stub',
      calls: 0,
      async completeJson() {
        c.calls++;
        return { text: '{}', model: 'stub', latencyMs: 1 };
      },
    };
    return c;
  };

  it('depois do teto a conversa não chama mais o modelo; outras conversas não são afetadas', async () => {
    const budget = createCallBudget({ maxCalls: 2 });
    const llm = stub();
    const a = budget.forConversation('a', llm);
    await a.completeJson(req);
    await a.completeJson(req);
    await expect(a.completeJson(req)).rejects.toMatchObject({ kind: 'limit_exceeded' });
    expect(llm.calls).toBe(2);
    expect(budget.used('a')).toBe(2);
    await budget.forConversation('b', llm).completeJson(req);
    expect(llm.calls).toBe(3);
  });

  it('com o limite estourado o bot cai nos parsers e repergunta', async () => {
    const budget = createCallBudget({ maxCalls: 0 });
    const ctx: StepContext = { state: 'PERFIL', question: 'Qual a renda?', fields: [{ key: 'renda_bruta', kind: 'money' }] };
    const r = await interpretReply('tipo 5 ou 6 mil', ctx, { llm: budget.forConversation('a', stub()), prompt });
    expect(r).toEqual({ kind: 'reask', reason: 'llm_unavailable' });
  });

  it('despeja a conversa mais antiga quando passa do tamanho máximo', async () => {
    const budget = createCallBudget({ maxCalls: 5, maxConversations: 2 });
    for (const id of ['a', 'b', 'c']) await budget.forConversation(id, stub()).completeJson(req);
    expect([budget.used('a'), budget.used('b'), budget.used('c')]).toEqual([0, 1, 1]);
  });
});
