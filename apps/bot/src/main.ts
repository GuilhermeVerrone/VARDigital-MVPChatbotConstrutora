import { readFileSync } from 'node:fs';
import { loadConfig } from './config';
import { createDependencyChecks } from './deps';
import { buildServer } from './server';

const config = loadConfig();

const https =
  config.BOT_TLS_CERT_FILE && config.BOT_TLS_KEY_FILE
    ? { cert: readFileSync(config.BOT_TLS_CERT_FILE), key: readFileSync(config.BOT_TLS_KEY_FILE) }
    : null;

const app = buildServer({
  webhookSecret: config.WA_AKG_WEBHOOK_SECRET,
  deps: createDependencyChecks({ databaseUrl: config.BOT_DATABASE_URL, ollamaBaseUrl: config.OLLAMA_BASE_URL }),
  captureDir: config.WEBHOOK_CAPTURE_DIR,
  fastify: {
    ...(https ? { https } : {}),
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: ['req.headers["x-webhook-signature"]', 'req.headers.authorization', 'req.headers["x-api-key"]'], censor: '[redacted]' },
    },
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'encerrando');
    void app.close().then(() => process.exit(0));
  });
}

app
  .listen({ host: config.BOT_HOST, port: config.BOT_PORT })
  .then(() => app.log.info({ tls: Boolean(https) }, 'bot pronto'))
  .catch((err: unknown) => {
    app.log.fatal({ err }, 'falha ao iniciar');
    process.exit(1);
  });
