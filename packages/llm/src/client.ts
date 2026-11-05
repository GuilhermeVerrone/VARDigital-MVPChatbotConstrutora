import { z } from 'zod';

export type LlmErrorKind = 'timeout' | 'unavailable' | 'bad_status' | 'empty' | 'invalid_output' | 'limit_exceeded';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmRequest {
  system: string;
  user: string;
  /** JSON Schema da saída; o servidor restringe a geração a ele. */
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmResponse {
  /** Texto JSON bruto devolvido pelo modelo. */
  text: string;
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

/** Fronteira com o modelo: trocar Ollama por API em nuvem é implementar esta interface. */
export interface LlmClient {
  readonly model: string;
  completeJson(req: LlmRequest): Promise<LlmResponse>;
}

export interface StructuredResult<T> {
  value: T;
  response: LlmResponse;
  /** Chamadas feitas (2 = a primeira saiu inválida e houve nova tentativa). */
  attempts: number;
}

/**
 * Chama o modelo e valida a saída com Zod. Saída que não é JSON ou não passa no schema conta como
 * inválida: uma nova tentativa e, se falhar de novo, `LlmError('invalid_output')`. Nunca devolve
 * dado sem validar.
 */
export async function generateStructured<S extends z.ZodType>(
  client: LlmClient,
  schema: S,
  req: Omit<LlmRequest, 'jsonSchema'>,
  maxAttempts = 2,
): Promise<StructuredResult<z.infer<S>>> {
  const jsonSchema = toJsonSchema(schema);
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await client.completeJson({ ...req, jsonSchema });
    try {
      const parsed = schema.safeParse(JSON.parse(response.text));
      if (parsed.success) return { value: parsed.data, response, attempts: attempt };
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch {
      lastError = 'resposta não é JSON';
    }
  }
  throw new LlmError('invalid_output', lastError);
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const full = z.toJSONSchema(schema) as Record<string, unknown>;
  delete full.$schema;
  return full;
}
