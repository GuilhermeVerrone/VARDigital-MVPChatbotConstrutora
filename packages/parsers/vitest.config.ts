import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'parsers', include: ['test/**/*.test.ts'] },
});
