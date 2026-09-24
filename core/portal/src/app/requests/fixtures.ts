// MCPForge — W0-J19: the default `RequestSource`. See `types.ts`'s header for
// why this seam exists.
//
// Every verdict below is NOT hand-picked: `page.tsx` calls `verdictFor` (the
// real ranker) at render time for "Ask" and for each tracked request's
// `askText`, against `fixtureCatalogSource()` (the same `CatalogData`
// `catalog/fixtures.ts` supplies the Catalog page). The three seeded asks
// below are chosen — and their real, measured scores checked in
// `rank-adapter.test.ts` — so the three tiers are all exercised for real once
// `verdictFor` runs over them: an ask naming `jde.ap.voucher.search`'s own
// verb ("search") clears the EXISTS boost line; an ask sharing vocabulary
// with several AP/AR tools but naming no tool's verb or entity lands as a
// near miss with real, distinct scores; an ask sharing no token at all with
// the fixture catalogue (a tokenizer property checked directly in
// `rank-adapter.test.ts`, not assumed) lands as new. Not by asserting a tier
// and skipping the ranker.
import { fixtureCatalogSource } from '../catalog/fixtures';
import { verdictFor } from './rank-adapter';
import type { RequestRecord, RequestSource } from './types';

// A FIXED anchor, not `Date.now()` — `page.tsx` is `'use client'`, so this
// module evaluates once during SSR and again on hydration; a wall-clock
// value differs between those two moments and produces a real hydration
// mismatch on any timestamp rendered from it (same fix as `activity/
// fixtures.ts`).
const NOW = new Date('2026-09-15T12:00:00.000Z').getTime();
const DAY = 24 * 60 * 60_000;

export function loadRequests(now: number = NOW): readonly RequestRecord[] {
  const data = fixtureCatalogSource();

  const askExists = 'search AP vouchers for supplier';
  const askNearMiss = 'look up bills for supplier by amount';
  const askNew = 'schedule robot firmware maintenance windows';

  // Sourced from the real `governance.owner` manifest field of the tool each
  // verdict actually points at — the same field `environments/types.ts`'s
  // `owningTeam` documents itself against (W0-J17 precedent) — never typed
  // by hand.
  const voucherSearchOwner =
    data.tools.find((t) => t.manifest.id === 'jde.ap.voucher.search')?.manifest.governance.owner ?? null;

  return [
    {
      id: 'req-001',
      askText: askExists,
      requestedBy: 'daniel.owusu@example.com',
      requestedAt: new Date(now - 6 * DAY).toISOString(),
      state: 'enabled',
      verdict: verdictFor(askExists, data),
      owningTeam: voucherSearchOwner,
    },
    {
      id: 'req-002',
      askText: askNearMiss,
      requestedBy: 'sofia.lund@example.com',
      requestedAt: new Date(now - 3 * DAY).toISOString(),
      state: 'triaged',
      verdict: verdictFor(askNearMiss, data),
      owningTeam: voucherSearchOwner,
    },
    {
      id: 'req-003',
      askText: askNew,
      requestedBy: 'nina.oduya@example.com',
      requestedAt: new Date(now - 1 * DAY).toISOString(),
      state: 'submitted',
      verdict: verdictFor(askNew, data),
      owningTeam: null,
    },
  ];
}

/** The Requests page's default `RequestSource` — see `types.ts`'s file header. */
export const fixtureRequestSource: RequestSource = () => loadRequests();
