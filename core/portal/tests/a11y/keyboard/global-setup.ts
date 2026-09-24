import { request, type FullConfig } from '@playwright/test';

// MCPForge — W0-J21 gate 4 root-cause fix.
//
// ROOT CAUSE (established by direct reproduction, not guessed): the
// suite's flakiness is NOT cross-spec/worker concurrency — running with
// `--workers=1` (fully serial, zero concurrency) still failed, and failed
// on a DIFFERENT, larger set of specs than any concurrent run. Every
// observed failure was a normal Playwright default-timeout (5000ms)
// `expect(locator).toBeVisible()`/`toContainText()` on an element that
// exists in the DOM once the route's client bundle finishes compiling —
// i.e. genuine first-hit, on-demand dev-server compile latency (this
// file's neighbour, playwright.config.ts, already names this class of
// cost in its own header) outrunning each spec's short per-`expect`
// timeout, not a hang and not a shared-resource race. (The
// `.mcpforge/change-host-sandbox/` git seeding path — the other
// candidate this task was asked to check — IS a real, separately fixed
// concurrency bug in `lib/change-host/local-git-actions.ts`'s
// `ensureHost()`, but it is not what was causing these four flows'
// failures: only `role-edit.spec.ts` exercises it, and the other three
// failing flows never touch `ChangeHost` at all.)
//
// FIX: pay the first-compile cost for every route this suite's six specs
// navigate to ONCE, here, in `globalSetup` — outside any per-test
// timeout — before the timed specs run. A plain `request` context is
// enough: Next.js dev compiles a route (server AND the client bundles it
// references) on the first HTTP hit to it, whether that hit comes from a
// real page navigation or a bare GET.
const ROUTES = [
  '/approvals',
  // `approve.spec.ts` clicks through to the dynamic detail route — Next.js
  // dev compiles a dynamic segment's module once regardless of which param
  // value triggers it, so any id here pays that compile cost up front. Not
  // a real approval id on purpose (this is a compile warm-up, not a data
  // fixture read).
  '/approvals/warmup-probe',
  '/catalog',
  '/home',
  '/build/draft-voucher-create',
  '/activity/calls/call_ex4402',
  '/governance',
] as const;

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:3100';
  const context = await request.newContext({ baseURL });
  try {
    for (const route of ROUTES) {
      // Sequential, not Promise.all: on a cold dev server, concurrent
      // first-hits are exactly the compile-queue contention this suite's
      // own header already warns about — warming must not recreate it.
      await context.get(route, { timeout: 90_000 }).catch(() => {
        // A warm-up hit's HTTP status doesn't matter (some of these routes
        // legitimately redirect or need client-side data); only that the
        // route's compile has been triggered and has settled by the time
        // this request resolves.
      });
    }
  } finally {
    await context.dispose();
  }
}
