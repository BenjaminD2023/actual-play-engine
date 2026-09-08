import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@actualplay/engine/production': path.resolve(__dirname, '../engine/src/production/index.ts'),
      '@actualplay/engine/vtt': path.resolve(__dirname, '../engine/src/vtt/index.ts'),
      '@actualplay/engine': path.resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
