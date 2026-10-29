import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './client';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** Quanto tempo o modelo fica na memória após a última chamada. */
  keepAlive?: string;
  /** Envia `think: false` (modelos com raciocínio, ex.: qwen3). Outros modelos recusam o campo. */
  disableThinking?: boolean;
  fetch?: typeof fetch;
}

export function loadLlmConfig(env: Record<string, string | undefined>): OllamaOptions {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    baseUrl: env.OLLAMA_URL ?? 'http://localhost:11434',
    model: env.LLM_MODEL ?? 'qwen2.5:3b',
    timeoutMs: num(env.LLM_TIMEOUT_MS, 20_000),
    disableThinking: env.LLM_DISABLE_THINKING === 'true',
  };
}

/** Cliente do Ollama (`/api/chat`) com saída restrita a JSON Schema e temperatura 0. */
export class OllamaClient implements LlmClient {
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OllamaOptions) {
    this.model = opts.model;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async completeJson(req: LlmRequest): Promise<LlmResponse> {
    const timeoutMs = req.timeoutMs ?? this.opts.timeoutMs ?? 20_000;
    const started = performance.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.opts.model,
          stream: false,
          format: req.jsonSchema,
          keep_alive: this.opts.keepAlive ?? '30m',
          ...(this.opts.disableThinking ? { think: false } : {}),
          options: { temperature: 0, seed: 0, num_predict: req.maxTokens ?? 256 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new LlmError('timeout', `Ollama não respondeu em ${timeoutMs} ms`);
      throw new LlmError('unavailable', `Ollama inacessível: ${(e as Error).message}`);
    }
    if (!res.ok) throw new LlmError('bad_status', `Ollama respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const text = body.message?.content;
    if (!text) throw new LlmError('empty', 'Ollama devolveu resposta vazia');
    return {
      text,
      model: this.opts.model,
      latencyMs: Math.round(performance.now() - started),
      ...(body.prompt_eval_count !== undefined ? { promptTokens: body.prompt_eval_count } : {}),
      ...(body.eval_count !== undefined ? { completionTokens: body.eval_count } : {}),
    };
  }
}
