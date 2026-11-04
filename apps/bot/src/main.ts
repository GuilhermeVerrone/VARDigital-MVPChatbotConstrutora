import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPhoneAllowlist, restrictChannel, WaAkgAdapter } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { createDb } from '@mvp/db';
import { loadPrompt, OllamaClient } from '@mvp/llm';
import { loadConfig } from './config';
import { LOG_REDACT_PATHS } from './lib/mask';
import { createDeliveryHandler } from './delivery';
import { createDeliveryWorker } from './delivery-worker';
import { createDependencyChecks } from './deps';
import { createDbInbox } from './inbox';
import { createOrchestrator } from './orchestrator';
import { buildServer } from './server';
import { createWorker } from './worker';

const config = loadConfig();

const https =
  config.BOT_TLS_CERT_FILE && config.BOT_TLS_KEY_FILE
    ? { cert: readFileSync(config.BOT_TLS_CERT_FILE), key: readFileSync(config.BOT_TLS_KEY_FILE) }
    : null;

const db = createDb(config.BOT_DATABASE_URL);
const inbox = createDbInbox(db, { lockMs: config.INBOX_LOCK_MS, maxAttempts: config.INBOX_MAX_ATTEMPTS });
const allowlist = createPhoneAllowlist(config.ALLOWED_PHONES);
const channel = restrictChannel(
  new WaAkgAdapter({
  baseUrl: config.WA_AKG_BASE_URL,
  apiKey: config.WA_AKG_API_KEY,
  sessionId: config.WA_AKG_SESSION_ID,
  }),
  allowlist,
);

const promptsDir =
  config.PROMPTS_DIR ?? [resolve('prompts'), resolve('../../prompts')].find((d) => existsSync(join(d, `extraction.v${config.LLM_PROMPT_VERSION}.md`)));
if (config.LLM_ENABLED && !promptsDir) throw new Error('prompts/ não encontrado: defina PROMPTS_DIR ou LLM_ENABLED=false');

const handle = createOrchestrator({
  db,
  channel,
  hashSecret: config.CHAT_HASH_SECRET,
  maxTypingMs: config.TYPING_MAX_MS,
  resumeGapMs: config.CONVERSATION_RESUME_GAP_MS,
  retentionMs: config.CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  onJobsEnqueued: () => deliveryWorker.kick(),
  ...(config.LLM_ENABLED && promptsDir
    ? {
        llm: {
          llm: new OllamaClient({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, timeoutMs: config.LLM_TIMEOUT_MS }),
          prompt: loadPrompt(promptsDir, 'extraction', config.LLM_PROMPT_VERSION),
        },
      }
    : {}),
});

const app = buildServer({
  webhookSecret: config.WA_AKG_WEBHOOK_SECRET,
  inbox,
  sessionId: config.WA_AKG_SESSION_ID,
  allowlist,
  onEnqueued: () => worker.kick(),
  deps: createDependencyChecks({ databaseUrl: config.BOT_DATABASE_URL, ollamaBaseUrl: config.OLLAMA_BASE_URL }),
  captureDir: config.WEBHOOK_CAPTURE_DIR,
  fastify: {
    ...(https ? { https } : {}),
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
    },
  },
});

const worker = createWorker({
  inbox,
  handle,
  log: app.log,
  maxAttempts: config.INBOX_MAX_ATTEMPTS,
  pollMs: config.INBOX_POLL_MS,
});

const deliveryWorker = createDeliveryWorker({
  db,
  handle: createDeliveryHandler({ db, channel, crm: new SimulatedCrm(db), contactWithinMinutes: config.BROKER_CONTACT_MINUTES }),
  log: app.log,
  maxAttempts: config.DELIVERY_MAX_ATTEMPTS,
  lockMs: config.DELIVERY_LOCK_MS,
  pollMs: config.DELIVERY_POLL_MS,
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'encerrando');
    // Primeiro para de receber, depois deixa o worker terminar a mensagem em curso.
    void app
      .close()
      .then(() => worker.stop())
      .then(() => deliveryWorker.stop())
      .then(() => db.$disconnect())
      .finally(() => process.exit(0));
  });
}

app
  .listen({ host: config.BOT_HOST, port: config.BOT_PORT })
  .then(() => {
    worker.start();
    deliveryWorker.start();
    app.log.info({ tls: Boolean(https), session: config.WA_AKG_SESSION_ID }, 'bot pronto');
  })
  .catch((err: unknown) => {
    app.log.fatal({ err }, 'falha ao iniciar');
    process.exit(1);
  });
