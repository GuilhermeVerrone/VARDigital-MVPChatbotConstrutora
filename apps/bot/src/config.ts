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
