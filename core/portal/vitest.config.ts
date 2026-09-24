import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Package-local runner so `pnpm -C core/portal test` stands on its own,
// independent of the root vitest config — same pattern as
// core/shared/vitest.config.ts and its siblings.
//
// Two things the root config does not need but this package does:
//  - the `@/*` path alias (tsconfig.json), so component tests can import
//    the way the app itself does (`@/components/ui/dialog`, ...);
//  - a jsdom environment for the accessibility tests (a11y.test.tsx sets
//    `@vitest-environment jsdom` per-file; `node` stays the default for
//    the plain .ts unit tests already in src/app and src/design).
export default defineConfig({
  // tsconfig.json sets "jsx": "preserve" for Next's own compiler; Vitest's
  // esbuild transform needs an explicit setting instead, since its default
  // is the classic runtime (React.createElement without auto-import).
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // W0-J21 — `tests/a11y/**` holds gates 3/4's Playwright specs
    // (`*.spec.ts`, run by `@playwright/test`, never by Vitest) plus any
    // future Vitest-based a11y gap-fillers (`*.test.ts`). Only `.test.ts`
    // is added to Vitest's include here — adding `.spec.ts` too would make
    // Vitest try to collect the Playwright specs themselves and fail on
    // their `@playwright/test` imports.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/a11y/**/*.test.{ts,tsx}'],
    exclude: ['tests/a11y/**/*.spec.ts', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // `change-host.contract.test.ts` and this task's
    // `local-git-actions.test.ts` shell out to real `git` processes; under
    // full-suite parallel worker contention on Windows those subprocess
    // spawns can legitimately exceed Vitest's 5s default even though each
    // test passes comfortably in isolation (~1s). Widened rather than
    // serialised, matching this repo's own precedent
    // (playwright.config.ts's `timeout: 90_000` for the same reason).
    testTimeout: 20_000,
  },
});
