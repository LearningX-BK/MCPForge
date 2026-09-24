import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C core/shared test` stands on its own
// (W0-A4 `done:`), independent of the root vitest config.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
