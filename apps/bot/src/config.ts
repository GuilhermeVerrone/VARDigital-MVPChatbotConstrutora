import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BOT_HOST: z.string().default('0.0.0.0'),
  BOT_PORT: z.coerce.number().int().positive().default(3100),
  // Se ambos definidos, o bot sobe em HTTPS (o WA-AKG só entrega webhook em HTTPS).
  BOT_TLS_CERT_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  BOT_TLS_KEY_FILE: z.preprocess(emptyToUndefined, z.string().optional()),
  WA_AKG_WEBHOOK_SECRET: z.string().min(16, 'WA_AKG_WEBHOOK_SECRET precisa de pelo menos 16 caracteres'),
  BOT_DATABASE_URL: z.string().url(),
  // API REST do WA-AKG (envio de mensagens, presença, leitura).
  WA_AKG_BASE_URL: z.string().url().default('http://localhost:3000'),
  WA_AKG_API_KEY: z.string().min(1, 'WA_AKG_API_KEY é obrigatória (gerada por infra/scripts/wa-akg-bootstrap.sh)'),
  WA_AKG_SESSION_ID: z.string().min(1).default('piloto'),
  // Telefones que o bot atende e para os quais envia (separados por vírgula). Obrigatório:
  // sem lista o bot não sobe, para nunca responder a quem não deveria.
  ALLOWED_PHONES: z
    .string()
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^\+?[\d\s()-]{10,20}$/, 'telefone inválido')).min(1, 'ALLOWED_PHONES precisa de pelo menos um telefone')),
  // Fila de entrada: intervalo de consulta, tempo de reserva por mensagem e tentativas.
  INBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  INBOX_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  INBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  // Conversa (Fase 5). O segredo gera o hash da conversa antes do consentimento (nenhum telefone legível).
  CHAT_HASH_SECRET: z.string().min(16, 'CHAT_HASH_SECRET precisa de pelo menos 16 caracteres'),
  CONVERSATION_RETENTION_DAYS: z.coerce.number().positive().default(7),
  CONVERSATION_RESUME_GAP_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // Retenção (LGPD): leads sem atividade há mais de N dias são apagados (0 desliga). A rotina roda a cada RETENTION_SWEEP_MS.
  LEAD_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
  RETENTION_SWEEP_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // Limites de entrada: mensagens por conversa por minuto (0 desliga) e tamanho máximo do texto aceito.
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(0).default(30),
  MAX_TEXT_CHARS: z.coerce.number().int().min(0).default(2000),
  TYPING_MAX_MS: z.coerce.number().int().min(0).default(2_000),
  // Entregas ao CRM e ao corretor (Fase 6): fila de saída com nova tentativa e espera crescente.
  DELIVERY_POLL_MS: z.coerce.number().int().positive().default(1000),
  DELIVERY_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),
  // Prazo para o corretor ligar, citado no "próximo passo" do dossiê (o SLA configurável é pós-MVP).
  BROKER_CONTACT_MINUTES: z.coerce.number().int().positive().default(5),
  // LLM (fallback dos parsers e FAQ). LLM_ENABLED=false → só parsers. Provedor: API da Anthropic (padrão) ou
  // Ollama local (perfil opcional do compose). Sem chave o bot segue só com os parsers.
  LLM_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  LLM_PROVIDER: z.enum(['anthropic', 'ollama']).default('anthropic'),
  // Vazio = padrão do provedor (claude-haiku-5-5 na Anthropic, qwen2.5:7b no Ollama).
  LLM_MODEL: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Teto de chamadas ao LLM por conversa (custo): depois dele só os parsers (0 desliga o LLM).
  LLM_MAX_CALLS_PER_CONVERSATION: z.coerce.number().int().min(0).default(30),
  LLM_PROMPT_VERSION: z.coerce.number().int().positive().default(3),
  PROMPTS_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  // Somente desenvolvimento: grava payloads brutos recebidos (contêm dados pessoais).
  WEBHOOK_CAPTURE_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`configuração inválida: ${issues}`);
  }
  if (Boolean(parsed.data.BOT_TLS_CERT_FILE) !== Boolean(parsed.data.BOT_TLS_KEY_FILE)) {
    throw new Error('configuração inválida: defina BOT_TLS_CERT_FILE e BOT_TLS_KEY_FILE juntos');
  }
  return parsed.data;
}
