// MCPForge — the global command palette's `FindClient` fixture.
//
// Moved here (from the now-retired `app/home/_lib/find-fixture.ts`) by
// W0-J22: the palette is composed once, globally (`components/shell/
// app-chrome.tsx`), not `/home`-locally, so its `FindClient` fixture lives
// beside the palette component it feeds rather than under one route. No
// live gateway `/api/find` route exists yet (`find-client.ts`'s own header
// explains why), so this is an injectable function typed exactly against
// the real `forge.find` contract (`FindClient`/`FindInput`/`FindResponse`),
// returning realistic fixture results rather than a hand-rolled shape.
// Swapping it for `(input) => fetch('/api/find', ...)` touches no component
// that imports it — every caller only ever imports the `FindClient` type.
//
// The one entry below, `jde.ap.voucher.create`, is a REAL manifest id (see
// `../../app/catalog/fixtures.ts`), not an invented one — so a result the
// palette shows here is a tool the Catalog can actually open.
import { readCardFields } from './card-fields';
import type { FindClient, FindInput, FindResponse, FindResultEntry } from './find-client';

const FIXTURE_ENTRIES: readonly FindResultEntry[] = [
  {
    card: {
      id: 'jde.ap.voucher.create',
      purpose: 'Create an AP voucher against a supplier.',
      verb: 'create',
      entity: 'voucher',
      write: true,
      binding: 'function',
      sensitivity: 'financial',
      status: 'resolved',
    },
    score: 0.93,
    access: 'available',
  },
  {
    card: {
      id: 'jde.ap.voucher.search',
      purpose: 'Find existing AP vouchers by supplier, status or date range.',
      verb: 'search',
      entity: 'voucher',
      write: false,
      binding: 'function',
      sensitivity: 'financial',
      status: 'resolved',
    },
    score: 0.74,
    access: 'available',
  },
];

/** Case-insensitive substring match over each entry's id and purpose — enough for the palette's own debounced query, not a re-implementation of `forge.find`'s ranking. */
export const fixtureFindClient: FindClient = async (input: FindInput): Promise<FindResponse> => {
  const q = (input.query ?? '').trim().toLowerCase();
  const tools =
    q.length === 0
      ? FIXTURE_ENTRIES
      : FIXTURE_ENTRIES.filter((e) => {
          const fields = readCardFields(e.card);
          return fields.id.toLowerCase().includes(q) || (fields.purpose ?? '').toLowerCase().includes(q);
        });
  if (tools.length === 0) {
    return {
      result: 'no_tool',
      reason: `No tool matched "${input.query ?? ''}".`,
      nearest: [],
      next: 'Try a shorter query, or open Requests to ask for this capability.',
    };
  }
  return { result: 'tools', tools: [...tools].sort((a, b) => b.score - a.score) };
};
