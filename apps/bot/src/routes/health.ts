import type { FastifyInstance } from 'fastify';
import type { DependencyChecks } from '../deps';

export function healthRoutes(app: FastifyInstance, deps: DependencyChecks) {
  // Healthcheck do Docker a cada 10 s: não polui o log.
  app.get('/health', { logLevel: 'warn' }, async () => ({ status: 'ok' }));

  app.get('/health/deps', async (_req, reply) => {
    const [postgres, llm] = await Promise.all([deps.postgres(), deps.llm()]);
    // Sem banco o bot não funciona (503). Sem LLM ele segue só com os parsers: 200, mas degradado.
    const code = postgres.ok ? 200 : 503;
    return reply.code(code).send({ status: postgres.ok && llm.ok ? 'ok' : 'degraded', postgres, llm });
  });
}
