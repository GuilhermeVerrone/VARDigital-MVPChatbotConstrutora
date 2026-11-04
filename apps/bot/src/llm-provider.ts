import { AnthropicClient, loadPrompt, OllamaClient, type LlmClient, type LlmRequest, type LlmResponse, type Prompt } from '@mvp/llm';
import type { Config } from './config';
import type { DependencyStatus } from './deps';

// Escolha do provedor de LLM (D13) e acompanhamento da saúde dele. O bot nunca depende do LLM:
// sem chave, sem prompt ou com a API fora do ar ele segue só com os parsers e repergunta; o /health/deps
// mostra o LLM como degradado.

/** Quanto tempo uma falha seguida de nenhum acerto mantém o LLM como degradado. */
const DEGRADED_WINDOW_MS = 5 * 60_000;

export interface LlmMonitor {
  /** Envolve o cliente registrando acertos e falhas (só o tipo da falha, nunca conteúdo). */
  wrap(client: LlmClient): LlmClient;
  status(): DependencyStatus;
}

export interface LlmSetup {
  /** Dependências do interpretador; ausente = só parsers. */
  llm?: { llm: LlmClient; prompt: Prompt };
  monitor: LlmMonitor;
  /** Motivo de estar sem LLM (para o log de inicialização). */
  disabledReason?: string;
}

export function createLlmMonitor(opts: { provider: string; model: string; staticProblem?: string; now?: () => number }): LlmMonitor {
  const now = opts.now ?? Date.now;
  /** A última chamada falhou e nenhuma deu certo depois dela. */
  let lastFail: { at: number; kind: string } | null = null;
  return {
    wrap(client) {
      return {
        model: client.model,
        async completeJson(req: LlmRequest): Promise<LlmResponse> {
          try {
            const res = await client.completeJson(req);
            lastFail = null;
            return res;
          } catch (e) {
            lastFail = { at: now(), kind: (e as { kind?: string }).kind ?? 'erro' };
            throw e;
          }
        },
      };
    },
    status() {
      if (opts.staticProblem) return { ok: false, latencyMs: 0, detail: opts.staticProblem };
      if (lastFail && now() - lastFail.at < DEGRADED_WINDOW_MS) {
        return { ok: false, latencyMs: 0, detail: `${opts.provider}: última chamada falhou (${lastFail.kind}); o bot usa só os parsers` };
      }
      return { ok: true, latencyMs: 0, detail: `${opts.provider}:${opts.model}` };
    },
  };
}

export function setupLlm(config: Config, promptsDir: string | undefined): LlmSetup {
  const provider = config.LLM_PROVIDER;
  const model = config.LLM_MODEL ?? (provider === 'ollama' ? 'qwen2.5:7b' : 'claude-haiku-5-5');
  const off = (reason: string): LlmSetup => ({
    monitor: createLlmMonitor({ provider, model, staticProblem: reason }),
    disabledReason: reason,
  });

  if (!config.LLM_ENABLED) return { monitor: createLlmMonitor({ provider: 'desligado', model: '-' }), disabledReason: 'LLM_ENABLED=false' };
  if (!promptsDir) return off('prompts/ não encontrado: só parsers');

  let client: LlmClient;
  if (provider === 'anthropic') {
    if (!config.ANTHROPIC_API_KEY) return off('ANTHROPIC_API_KEY ausente: só parsers');
    client = new AnthropicClient({ apiKey: config.ANTHROPIC_API_KEY, model, timeoutMs: config.LLM_TIMEOUT_MS });
  } else {
    client = new OllamaClient({ baseUrl: config.OLLAMA_BASE_URL, model, timeoutMs: config.LLM_TIMEOUT_MS });
  }
  const monitor = createLlmMonitor({ provider, model });
  return { llm: { llm: monitor.wrap(client), prompt: loadPrompt(promptsDir, 'extraction', config.LLM_PROMPT_VERSION) }, monitor };
}
