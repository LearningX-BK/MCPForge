import { defineConfig } from 'vitest/config';

// MCPForge — one root Vitest run across the workspace (CLAUDE.md §5).
// A single runner means `pnpm test -- <filter>` filters by test-file path,
// e.g. `pnpm test -- eslint-rules`.
//
// W0-B11 — `core/portal` needs its own path alias (`@/*`), an
// `esbuild.jsx: 'automatic'` transform and a jsdom-capable setup that the
// rest of the workspace does not carry. Rather than retype those settings
// here (a second, driftable copy of `core/portal/vitest.config.ts`), this
// config declares a Vitest "project" per package: the default project keeps
// today's flat include/exclude for everything else, and a second project
// entry is the literal path to `core/portal/vitest.config.ts`, so Vitest
// loads and applies that file's own object directly. `pnpm test` (no `-C`,
// no filter) still runs as a single `vitest run` — projects just partition
// which settings apply to which files within that one run.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'root',
          include: ['**/*.{test,spec}.{ts,tsx,js,mjs}'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            // W0-B10 — `generated/**` is NOT excluded. Every generated
            // `contract.test.ts` / `unit.test.ts` is collected and run by the
            // same plain `pnpm test` a hand-written package's tests are, and
            // therefore by `forge ci`'s existing test stage. The three
            // specifiers those files import (`ajv`, `ajv-formats`,
            // `@mcpforge/shared/*`) are hoisted to root devDependencies so
            // they resolve from `generated/` through ordinary node
            // resolution — no alias, no throwaway config, and no generated
            // `package.json`, which would have put a second hand-editable
            // surface inside the tree 02 §2.4 keeps hand-owned to
            // `binding.custom.ts`.
            'adapters/oracle-worker/**',
            '.forge-build/**',
            // W0-B11 — core/portal's tests are owned by its own project
            // entry below (its own include/alias/jsx/environment/setup);
            // excluding it here avoids collecting those files twice.
            'core/portal/**',
          ],
        },
      },
      'core/portal/vitest.config.ts',
    ],
  },
});
