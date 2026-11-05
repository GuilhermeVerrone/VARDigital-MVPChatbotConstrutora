import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPhoneAllowlist, restrictChannel, WaAkgAdapter } from '@mvp/channel';
import { SimulatedCrm } from '@mvp/crm';
import { createDb } from '@mvp/db';
import { createCallBudget } from '@mvp/llm';
import { loadConfig } from './config';
import { parseClock, parseDays } from './lib/business-hours';
import { LOG_REDACT_PATHS } from './lib/mask';
import { createDeliveryHandler } from './delivery';
import { createDeliveryWorker } from './delivery-worker';
import { createDependencyChecks, probeOllama } from './deps';
import { createDbInbox } from './inbox';
import { createRateLimiter } from './lib/rate-limit';
import { createRetention } from './retention';
import { setupLlm } from './llm-provider';
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
const llmSetup = setupLlm(config, promptsDir);

const handle = createOrchestrator({
  db,
  channel,
  hashSecret: config.CHAT_HASH_SECRET,
  maxTypingMs: config.TYPING_MAX_MS,
  resumeGapMs: config.CONVERSATION_RESUME_GAP_MS,
  retentionMs: config.CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  onJobsEnqueued: () => deliveryWorker.kick(),
  log: { warn: (o, m) => app.log.warn(o, m), info: (o, m) => app.log.info(o, m) },
  ...(llmSetup.llm
    ? { llm: llmSetup.llm, llmBudget: createCallBudget({ maxCalls: config.LLM_MAX_CALLS_PER_CONVERSATION }) }
    : {}),
});

const app = buildServer({
  webhookSecret: config.WA_AKG_WEBHOOK_SECRET,
  inbox,
  sessionId: config.WA_AKG_SESSION_ID,
  allowlist,
  onEnqueued: () => worker.kick(),
  deps: createDependencyChecks({
    databaseUrl: config.BOT_DATABASE_URL,
    llm: config.LLM_PROVIDER === 'ollama' && llmSetup.llm ? probeOllama(config.OLLAMA_BASE_URL) : async () => llmSetup.monitor.status(),
  }),
  captureDir: config.WEBHOOK_CAPTURE_DIR,
  rateLimiter: createRateLimiter({ max: config.RATE_LIMIT_PER_MIN, windowMs: 60_000 }),
  maxTextChars: config.MAX_TEXT_CHARS,
  fastify: {
    ...(https ? { https } : {}),
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' },
    },
  },
});

if (llmSetup.disabledReason) app.log.warn({ reason: llmSetup.disabledReason }, 'LLM desligado: o bot segue só com os parsers');

const worker = createWorker({
  inbox,
  handle,
  log: app.log,
  maxAttempts: config.INBOX_MAX_ATTEMPTS,
  pollMs: config.INBOX_POLL_MS,
});

const deliveryWorker = createDeliveryWorker({
  db,
  handle: createDeliveryHandler({
    db,
    channel,
    crm: new SimulatedCrm(db),
    contactWithinMinutes: config.BROKER_CONTACT_MINUTES,
    firstContact: {
      window: {
        startMin: parseClock(config.FIRST_CONTACT_START),
        endMin: parseClock(config.FIRST_CONTACT_END),
        days: parseDays(config.FIRST_CONTACT_DAYS),
        timeZone: config.FIRST_CONTACT_TIMEZONE,
      },
      maxPerHour: config.FIRST_CONTACT_MAX_PER_HOUR,
      isAllowed: (phone) => allowlist.isAllowed(phone),
    },
  }),
  log: app.log,
  maxAttempts: config.DELIVERY_MAX_ATTEMPTS,
  lockMs: config.DELIVERY_LOCK_MS,
  pollMs: config.DELIVERY_POLL_MS,
});

const retention = createRetention({ db, days: config.LEAD_RETENTION_DAYS, intervalMs: config.RETENTION_SWEEP_MS, log: app.log });

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'encerrando');
    // Primeiro para de receber, depois deixa o worker terminar a mensagem em curso.
    void app
      .close()
      .then(() => retention.stop())
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
    retention.start();
    app.log.info({ tls: Boolean(https), session: config.WA_AKG_SESSION_ID, retentionDays: config.LEAD_RETENTION_DAYS }, 'bot pronto');
  })
  .catch((err: unknown) => {
    app.log.fatal({ err }, 'falha ao iniciar');
    process.exit(1);
  });
