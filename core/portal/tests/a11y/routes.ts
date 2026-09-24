// MCPForge — W0-J21 gate 3's route list.
//
// Every static route under `src/app/**/page.tsx` as of this task, minus the
// parallel-route intercept (`@modal`) which is not itself a navigable URL.
// Dynamic segments get one representative id — `forge ci`/this spec's job
// is checking the shell each route renders responds and is accessible, not
// re-deriving fixture data per id. Keep this list in sync with
// `src/app/**/page.tsx` by eye; there is no codegen for it (it is a handful
// of routes, not the tool catalogue).
export const ROUTES: readonly string[] = [
  '/home',
  '/catalog',
  '/catalog/jde.ap.voucher.search',
  '/build',
  '/build/draft-voucher-create',
  '/activity',
  '/activity/calls/call_a1f9e0',
  '/approvals',
  '/requests',
  '/environments',
  '/environments/enablement',
  '/environments/packages',
  '/governance',
  '/governance/policy',
  '/governance/posture',
  '/governance/kill-switch',
  '/insights',
];
