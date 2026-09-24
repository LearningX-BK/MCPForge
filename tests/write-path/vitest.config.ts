import { defineConfig } from 'vitest/config';

// Package-local runner, matching tests/policy's convention (W0-E8) so
// `pnpm --filter @mcpforge/write-path-tests test` stands on its own. The
// evidence markdown is generated as a SEPARATE step after this run (see
// package.json's `test` script and scripts/generate-evidence.ts) rather than
// inside a vitest reporter, because each of the four criterion files may run
// in its own worker and evidence is written to disk, not held in shared
// module state, for exactly that reason.
export default defineConfig({
  test: {
    include: ['*.{test,spec}.ts'],
  },
});
