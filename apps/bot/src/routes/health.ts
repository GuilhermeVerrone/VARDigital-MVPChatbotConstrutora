import type { FastifyInstance } from 'fastify';
import type { DependencyChecks } from '../deps';

export function healthRoutes(app: FastifyInstance, deps: DependencyChecks) {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/deps', async (_req, reply) => {
    const [postgres, ollama] = await Promise.all([deps.postgres(), deps.ollama()]);
    const ok = postgres.ok && ollama.ok;
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', postgres, ollama });
  });
}
