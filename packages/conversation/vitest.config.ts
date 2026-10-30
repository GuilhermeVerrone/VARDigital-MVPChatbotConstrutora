import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'conversation', include: ['test/**/*.test.ts'] },
});
