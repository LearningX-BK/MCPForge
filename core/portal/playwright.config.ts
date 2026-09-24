import { defineConfig, devices } from '@playwright/test';

// MCPForge — W0-J21, accessibility CI gates 3 and 4 (03 §12.7).
//
// Gate 3: `@axe-core/playwright` on every route, in both themes
//   -> tests/a11y/axe-routes.spec.ts
// Gate 4: keyboard-only Playwright scripts for the six named flows
//   -> tests/a11y/keyboard/*.spec.ts
//
// Both suites drive the real Next.js dev server (`pnpm dev`), not a
// production build — 03 never asks for a production-bundle-only check, and
// the dev server is the faster, more available target for a laptop CI run
// (CLAUDE.md §3.1 "local-first"). `webServer` starts it and waits for the
// first 200 before any spec runs, and reuses an already-running server
// locally (not in CI) so a developer iterating on a route doesn't pay a
// server-restart tax per run.
//
// FIXED (two prior W0-J21 closing passes): the bundler-resolution defect
// that used to 500 every route is gone (see next.config.ts's
// `extensionAlias`/`resolveExtensions` and the client/server barrel split
// under core/gateway, core/codegen, core/registry). All 19 routes now
// prerender and the dev server serves every route in this suite.
//
// `workers` is capped (rather than left at the Playwright default, which
// scales to CPU count) because every worker hits the SAME single Next dev
// server, and the dev server compiles each route on first request — at full
// worker fan-out (20+ concurrent first-hits) that on-demand compile queues
// up and the slower routes blow the 30s per-test timeout though nothing is
// actually broken (a "did not respond 2xx" / bare test-timeout failure with
// no axe violation attached is this, not a real defect). `timeout` is also
// widened so a legitimately slower first paint (e.g. `/build/draft-1`'s
// editor bundle) isn't mistaken for a hang.
// W0-J21 gate-4 closing pass: warms every route the six keyboard specs
// navigate to, once, before any timed test runs — see
// tests/a11y/keyboard/global-setup.ts for the root cause this addresses
// (first-hit dev-server compile latency, not cross-spec concurrency).
// Harmless to run ahead of the axe-routes-only invocation too (a few
// seconds of overlap with routes that suite visits anyway).
export default defineConfig({
  testDir: './tests/a11y',
  testMatch: ['axe-routes.spec.ts', 'keyboard/**/*.spec.ts'],
  globalSetup: './tests/a11y/keyboard/global-setup.ts',
  fullyParallel: true,
  workers: 4,
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
