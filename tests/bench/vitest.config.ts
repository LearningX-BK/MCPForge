import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm --filter @mcpforge/bench-tests run test`
// stands on its own, matching tests/policy's own convention.
export default defineConfig({
  test: {
    include: ['*.{test,spec}.ts'],
  },
});
