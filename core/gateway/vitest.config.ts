import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C core/gateway test` stands on its own,
// matching core/shared and core/codegen.
export default defineConfig({
  test: {
    include: [
      '{store,api,identity,transport,scope,policy,reversal,errors,flags,caps,telemetry,meta,consumer,secrets,anomaly,assembly}/**/*.{test,spec}.ts',
      // W0-K2 — headless mode. Lives at the package root (launch.ts sits
      // beside index.ts, not under any of the subdirectories above).
      'launch.*.{test,spec}.ts',
    ],
  },
});
