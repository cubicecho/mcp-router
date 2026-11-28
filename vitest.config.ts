import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const resolve = createRequire(import.meta.url).resolve;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: [
            // graphql ships no exports map: Vite follows `module` to index.mjs while Node follows
            // `main` to index.js, and the two copies fail each other's instanceof checks.
            { find: /^graphql$/, replacement: resolve('graphql') },
          ],
        },
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
