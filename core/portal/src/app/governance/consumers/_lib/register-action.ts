'use server';
// MCPForge — W0-N12: 03 §16.2's **Register** action, as a server action.
//
// It scaffolds and returns the record's TEXT. It writes nothing: `consumers/`
// is reached only by a change proposal (02 §11.2, `consumers/README.md`), and
// `core/gateway/consumer/registry.ts` has no write path at all by design. The
// scaffold itself is the REAL `scaffoldConsumerRecord` — the same function
// `forge consumer new` calls — so a registration drafted in the portal and one
// drafted at the CLI are the same bytes, starting from the same closed
// position: no binding types, no roles, no packages, `writeAllowed: false`.
import { loadConsumerSources, scaffoldConsumerSource } from './repo-consumers';
import type { ConsumerSource } from '../types';

/** 02 §11.2 / `core/gateway/consumer/types.ts`'s own `SLUG_ID_RE`. */
const SLUG_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export interface RegisterScaffoldResult {
  readonly source?: ConsumerSource;
  readonly error?: { readonly message: string; readonly next: string };
}

export async function scaffoldConsumerAction(
  consumerId: string,
): Promise<RegisterScaffoldResult> {
  const id = consumerId.trim();
  if (!SLUG_ID_RE.test(id)) {
    return {
      error: {
        message: `"${id}" is not a usable consumer id.`,
        next: 'Use a lower-case slug — letters, digits, dot, dash or underscore, starting with a letter or digit — then Register again.',
      },
    };
  }
  // Ids are IMMUTABLE (CLAUDE.md §5): renaming is a retire-and-register pair.
  // So a collision is refused here rather than opening an editor that would
  // silently propose an overwrite of somebody else's registration.
  if (loadConsumerSources().some((s) => s.consumerId === id)) {
    return {
      error: {
        message: `A consumer with id "${id}" is already registered.`,
        next: `Select ${id} in the table above to change its authorization, or choose a different id — a consumer id is immutable and renaming is a retire-and-register pair, both recorded.`,
      },
    };
  }
  return { source: scaffoldConsumerSource(id) };
}
