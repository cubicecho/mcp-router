import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          sequence: { groupOrder: 0 },
          include: ['server/src/**/*.test.ts', 'shared/src/**/*.test.ts'],
        },
      },
      'app/vitest.config.ts',
      'app/vitest.stories.config.ts',
    ],
  },
});
