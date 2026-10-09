import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  // Tests run as a debug build (the mock AI is available).
  define: { __OC_DEBUG__: 'true' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
