import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'vitrine', include: ['test/**/*.test.ts'] },
});
