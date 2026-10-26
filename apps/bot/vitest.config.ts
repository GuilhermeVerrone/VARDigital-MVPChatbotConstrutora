import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'bot', include: ['test/**/*.test.ts'] },
});
