import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C core/registry test` stands on its own,
// mirroring core/codegen's and core/cli's setup.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
