import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

const appDir = fileURLToPath(new URL('.', import.meta.url));

// The stories run as tests in a real Chromium. They need the app's own Vite plugins, so this
// config builds on vite.config.ts and not on the jsdom one.
export default mergeConfig(
  viteConfig,
  defineConfig({
    root: appDir,
    plugins: [storybookTest({ configDir: fileURLToPath(new URL('./.storybook', import.meta.url)) })],
    test: {
      name: 'stories',
      browser: {
        enabled: true,
        headless: true,
        // Containers grant no user namespaces and a 64 MB /dev/shm, which kills the renderer mid-run.
        provider: playwright({ launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] } }),
        instances: [{ browser: 'chromium' }],
      },
      // After the node and jsdom projects, and one file at a time: parallel browser sessions drop their connection.
      sequence: { groupOrder: 1 },
      fileParallelism: false,
      testTimeout: 30_000,
    },
  }),
);
