import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm test:policy` (which filters to this package)
// stands on its own, matching core/gateway and core/codegen. The root runner
// (`pnpm test`) also picks these files up — the privilege-escalation suite is
// not a separate universe, it is the same tests run under their own gate.
export default defineConfig({
  test: {
    // Same slow-machine allowance as the root project (vitest.config.ts):
    // these tests boot a real gateway and spawn the CLI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['*.{test,spec}.ts'],
  },
});
