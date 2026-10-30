import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    // Vários projetos sobem Postgres e subprocessos (prisma/tsx); com todos os núcleos a máquina de
    // 16 GB não consegue iniciar os workers a tempo ("Failed to start forks worker").
    maxWorkers: 2,
  },
});
