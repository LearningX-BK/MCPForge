import { defineConfig } from 'vitest/config';

// Package-local runner, matching tests/write-path's convention (W0-F7) so
// `pnpm --filter @mcpforge/consumer-access-tests test` stands on its own. The
// evidence markdown is generated as a SEPARATE step after this run (see
// package.json's `test` script and scripts/generate-evidence.ts) rather than
// inside a vitest reporter, because each of the four criterion files may run
// in its own worker and evidence is written to disk, not held in shared
// module state, for exactly that reason.
export default defineConfig({
  test: {
    include: ['*.{test,spec}.ts'],
    // Criterion (b) and (d) mint real SQLite stores / temp git-shaped repos and
    // (d) shells out to the real codegen pipeline twice per case; give them
    // headroom rather than letting a slow disk flake the checkpoint evidence.
    testTimeout: 30_000,
  },
});
