import { defineConfig } from 'vitest/config';

// MCPForge — the opt-in "second CI matrix entry" (W0-C5, 02 §10.4 item 8).
//
// This config exists ONLY so that `store.contract.test.ts`'s Postgres leg
// (already written, conditional on MCPFORGE_TEST_POSTGRES_URL) runs against a
// real, disposable Postgres instead of requiring a human to have one running
// and export the URL by hand. It runs the SAME store contract test file the
// default `vitest.config.ts` runs — nothing here is a second suite, it is the
// same suite pointed at a second dialect, which is the whole discipline this
// task exists to realize (identical to how W0-D3 contract-tests the two
// `IdentityProvider` implementations against one suite, 02 §4.4).
//
// It is invoked ONLY by `pnpm test:postgres` (see package.json) — never by
// the default `pnpm test` — because starting a container requires Docker, and
// 02 §10.1 item 2 is explicit that Docker/a managed database may never become
// a prerequisite for the default Wave 0 path. `globalSetup` starts a
// Testcontainers-provisioned Postgres and sets MCPFORGE_TEST_POSTGRES_URL
// before any test file loads; `globalSetup`'s teardown stops it afterward.
//
// HOW A REAL CI PROVIDER RUNS THIS AS TWO MATRIX LEGS (this repo has no
// GitHub-Actions/GitLab-CI file of its own — per CLAUDE.md §3.1 CI here is
// host-agnostic, realized as `forge ci` / pnpm scripts, not a provider-specific
// YAML file):
//   leg 1 (always, no Docker required): `pnpm test`
//     -> runs vitest.config.ts -> store.contract.test.ts's SQLite leg runs,
//        its Postgres leg shows `describe.skip`, exactly as today.
//   leg 2 (Docker available): `pnpm test:postgres`
//     -> runs vitest.postgres.config.ts -> globalSetup provisions a real
//        postgres:16-alpine container -> the SAME store.contract.test.ts's
//        Postgres leg now executes for real, including the dialect-parity
//        boolean round-trip assertion added for this task -> the container is
//        torn down in globalTeardown.
// A provider's job matrix (e.g. GitHub Actions `strategy.matrix`, GitLab CI
// parallel jobs) would define two jobs, one running each command above; only
// leg 2's job needs a Docker-capable runner.
export default defineConfig({
  test: {
    include: ['store/store.contract.test.ts'],
    globalSetup: ['./store/test-postgres-global-setup.ts'],
    // Testcontainers pulls and starts a real container; give it room.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
