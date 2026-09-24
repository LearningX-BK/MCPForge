import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C core/cli test` stands on its own,
// independent of the root vitest config (mirrors core/shared's W0-A4 setup).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    // The CLI tests spawn the real `forge` entrypoint as a child process
    // (tsx registration + Commander parsing), so give them more headroom
    // than the default 5s.
    testTimeout: 20_000,
  },
});
