import Fastify, { type FastifyServerOptions } from 'fastify';
import type { PhoneAllowlist } from '@mvp/channel';
import type { DependencyChecks } from './deps';
import type { InboxWriter } from './inbox';
import { healthRoutes } from './routes/health';
import { waAkgWebhookRoutes } from './routes/wa-akg-webhook';

export interface ServerOptions {
  webhookSecret: string;
  inbox: InboxWriter;
  sessionId: string;
  allowlist: PhoneAllowlist;
  onEnqueued?: (() => void) | undefined;
  deps: DependencyChecks;
  captureDir?: string | undefined;
  fastify?: FastifyServerOptions;
}

export function buildServer(opts: ServerOptions) {
  const app = Fastify({
    ...opts.fastify,
    logger: opts.fastify?.logger ?? false,
  });

  healthRoutes(app, opts.deps);
  // Plugin encapsulado: o parser de corpo bruto vale só para as rotas de webhook.
  app.register(async (scope) => waAkgWebhookRoutes(scope, {
      secret: opts.webhookSecret,
      inbox: opts.inbox,
      sessionId: opts.sessionId,
      allowlist: opts.allowlist,
      onEnqueued: opts.onEnqueued,
      captureDir: opts.captureDir,
    }));

  return app;
}
