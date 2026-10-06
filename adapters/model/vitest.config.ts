import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C adapters/function test` stands on its own,
// mirroring core/registry's and core/codegen's setup.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
