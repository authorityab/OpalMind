import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@opalmind/sdk': resolve(__dirname, '../sdk/src'),
      '@opalmind/logger': resolve(__dirname, '../logger/src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
