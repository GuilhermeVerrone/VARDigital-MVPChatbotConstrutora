import Anthropic from '@anthropic-ai/sdk';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './client';

// Cliente da API da Anthropic (V2, D13) ao lado do OllamaClient, com a mesma interface. A saída é
// restrita ao JSON Schema (structured outputs) e o chamador ainda a valida com Zod. Timeout e nova
// tentativa (429, 5xx, rede) ficam por conta do SDK. Nada do conteúdo da requisição vai para log.

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Novas tentativas do SDK em 408/409/429/5xx e erro de rede (padrão 2). */
  maxRetries?: number;
  baseURL?: string;
  fetch?: typeof fetch;
}

/**
 * Palavras-chave de JSON Schema que os structured outputs não aceitam. Saem do schema enviado; a
 * validação (faixas, tamanhos) continua no Zod, depois da resposta.
 */
const UNSUPPORTED = new Set([
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems',
]);

export function toAnthropicSchema(schema: unknown): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (UNSUPPORTED.has(k)) continue;
      out[k] = k === 'properties' && typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)])) : walk(v);
    }
    if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export function loadAnthropicConfig(env: Record<string, string | undefined>): AnthropicOptions | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return { apiKey, model: env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL, timeoutMs: num(env.LLM_TIMEOUT_MS, 15_000) };
}

export class AnthropicClient implements LlmClient {
  readonly model: string;
  private readonly sdk: Anthropic;

  constructor(private readonly opts: AnthropicOptions) {
    this.model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.sdk = new Anthropic({
      apiKey: opts.apiKey,
      timeout: opts.timeoutMs ?? 15_000,
      maxRetries: opts.maxRetries ?? 2,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    const started = performance.now();
    let message: Anthropic.Message;
    try {
      message = await this.sdk.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens ?? 512,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          // Extração curta e barata: sem raciocínio e com esforço mínimo (a bateria mede o acerto).
          thinking: { type: 'disabled' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema: toAnthropicSchema(req.jsonSchema) } },
        },
        req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
      );
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError('timeout', 'a API da Anthropic não respondeu a tempo');
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError('unavailable', 'API da Anthropic inacessível');
      if (e instanceof Anthropic.APIError) {
        // Só o status e o tipo do erro: a mensagem pode repetir trechos da requisição.
        throw new LlmError('bad_status', `Anthropic respondeu ${e.status ?? '?'}${e.type ? ` (${e.type})` : ''}`);
      }
      throw new LlmError('unavailable', 'falha inesperada ao chamar a Anthropic');
    }
    if (message.stop_reason === 'refusal') throw new LlmError('empty', 'a Anthropic recusou a requisição');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    if (!text) throw new LlmError('empty', 'a Anthropic devolveu resposta vazia');
    return {
      text,
      model: message.model,
      latencyMs: Math.round(performance.now() - started),
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
    };
  }
}
