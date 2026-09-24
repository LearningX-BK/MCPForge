import { defineConfig } from 'vitest/config';

// Package-local runner, matching tests/policy's convention (its vitest.config.ts
// says why: `pnpm test:mocks`/`pnpm -C tests/mocks test` stands on its own, and
// the root `pnpm test` also picks these files up for free).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.{test,spec}.ts'],
  },
});
