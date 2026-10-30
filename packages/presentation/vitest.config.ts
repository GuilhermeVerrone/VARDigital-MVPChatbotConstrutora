import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'presentation', include: ['test/**/*.test.ts'] },
});
