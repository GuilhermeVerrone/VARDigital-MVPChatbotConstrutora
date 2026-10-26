import pg from 'pg';

export interface DependencyStatus {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

export interface DependencyChecks {
  postgres(): Promise<DependencyStatus>;
  ollama(): Promise<DependencyStatus>;
}

const TIMEOUT_MS = 3000;

async function timed(fn: () => Promise<string | undefined>): Promise<DependencyStatus> {
  const started = performance.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - started), ...(detail ? { detail } : {}) };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), detail: (err as Error).message };
  }
}

export function createDependencyChecks(opts: { databaseUrl: string; ollamaBaseUrl: string }): DependencyChecks {
  return {
    postgres: () =>
      timed(async () => {
        const client = new pg.Client({
          connectionString: opts.databaseUrl,
          connectionTimeoutMillis: TIMEOUT_MS,
          query_timeout: TIMEOUT_MS,
        });
        await client.connect();
        try {
          const res = await client.query<{ version: string }>('select version()');
          return res.rows[0]?.version.split(' ').slice(0, 2).join(' ');
        } finally {
          await client.end();
        }
      }),
    ollama: () =>
      timed(async () => {
        const res = await fetch(new URL('/api/tags', opts.ollamaBaseUrl), { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`ollama respondeu ${res.status}`);
        const body = (await res.json()) as { models?: { name: string }[] };
        return `models: ${(body.models ?? []).map((m) => m.name).join(', ') || '(nenhum)'}`;
      }),
  };
}
