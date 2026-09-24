// MCPForge — W0-J11: the palette's typed filter grammar (03 §9.2 rule 1).
//
// "`app:jde`, `verb:create`, `write:true`, `binding:plsql`, `package:jde-fin`,
// `role:p2p`, `status:disabled`, `sens:financial` — discoverable inline...
// The grammar maps 1:1 onto `forge.find` parameters and onto the Catalog
// facets — one mental model, three places."
//
// GAP, DOCUMENTED RATHER THAN PAPERED OVER (CLAUDE.md §8): the real
// `FindInput` (`core/gateway/meta/find.ts`) carries `app`, `module`,
// `entity`, `verb`, `write`, `bindingType`, `process` and `package` — it has
// no `role`, `status` or `sens` field. Those three prefixes are real per 03
// §9.2's own worked list and do map onto Catalog facets, but there is no
// corresponding `forge.find` parameter for them today (role is implicit in
// the session's own scope, not a query filter; status and sensitivity are
// response/index fields, not accepted inputs). Rather than inventing new
// `FindInput` fields that don't exist on the real function this component is
// contracted to call, this parser recognises all eight documented prefixes
// but only forwards the five that have a real `FindInput` home into the
// query sent to `FindClient`; `role:`/`status:`/`sens:` parse cleanly (so
// they don't leak into free text or break completions) and are surfaced
// separately as `clientFilters` for a future client-side narrowing pass,
// with the gap called out here and in this task's final report rather than
// silently routed to the server as if `forge.find` understood them.
import type { FindInput } from './find-client';

/** Prefixes that map directly onto a real `FindInput` field. */
export const FIND_INPUT_PREFIXES = [
  'app',
  'module',
  'entity',
  'verb',
  'write',
  'binding',
  'package',
  'process',
] as const;
export type FindInputPrefix = (typeof FIND_INPUT_PREFIXES)[number];

/** Documented in 03 §9.2 but with no `FindInput` counterpart today. See file header. */
export const CLIENT_ONLY_PREFIXES = ['role', 'status', 'sens'] as const;
export type ClientOnlyPrefix = (typeof CLIENT_ONLY_PREFIXES)[number];

export const ALL_FILTER_PREFIXES = [...FIND_INPUT_PREFIXES, ...CLIENT_ONLY_PREFIXES] as const;
export type FilterPrefix = (typeof ALL_FILTER_PREFIXES)[number];

const PREFIX_TO_FIND_INPUT_KEY: Record<FindInputPrefix, keyof FindInput> = {
  app: 'app',
  module: 'module',
  entity: 'entity',
  verb: 'verb',
  write: 'write',
  binding: 'bindingType',
  package: 'package',
  process: 'process',
};

export interface ClientOnlyFilters {
  role?: string;
  status?: string;
  sens?: string;
}

export interface ParsedQuery {
  /** The free-text remainder after every recognised `key:value` token is stripped. */
  text: string;
  /** Ready to spread into a `FindInput` (minus `query`/`limit`, which the caller owns). */
  findInput: Omit<FindInput, 'query' | 'limit'>;
  /** The three prefixes with no `FindInput` home yet. See file header. */
  clientFilters: ClientOnlyFilters;
  /** The raw, un-parsed input, verbatim. */
  raw: string;
}

const TOKEN_RE = /(\S+?):(\S+)/g;

function isFindInputPrefix(key: string): key is FindInputPrefix {
  return (FIND_INPUT_PREFIXES as readonly string[]).includes(key);
}
function isClientOnlyPrefix(key: string): key is ClientOnlyPrefix {
  return (CLIENT_ONLY_PREFIXES as readonly string[]).includes(key);
}

function parseValue(prefix: FindInputPrefix, raw: string): FindInput[keyof FindInput] {
  if (prefix === 'write') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return undefined;
  }
  return raw;
}

/**
 * Pure parser: `"record a supplier invoice app:jde write:true"` ->
 * `{ text: "record a supplier invoice", findInput: { app: 'jde', write: true }, clientFilters: {} }`.
 * Unknown `key:value` tokens (a prefix outside the closed grammar) are left
 * in the free text untouched — they are plausibly just part of the query
 * ("supplier:acme corp" is not a real prefix but a person might type a colon).
 */
export function parseQuery(raw: string): ParsedQuery {
  const findInput: Record<string, unknown> = {};
  const clientFilters: ClientOnlyFilters = {};
  const consumed: string[] = [];

  for (const match of raw.matchAll(TOKEN_RE)) {
    const [full, keyRaw, valueRaw] = match;
    if (!keyRaw || valueRaw === undefined) continue;
    const key = keyRaw.toLowerCase();

    if (isFindInputPrefix(key)) {
      const value = parseValue(key, valueRaw);
      if (value !== undefined) {
        findInput[PREFIX_TO_FIND_INPUT_KEY[key]] = value;
        consumed.push(full);
      }
      continue;
    }

    if (isClientOnlyPrefix(key)) {
      clientFilters[key] = valueRaw;
      consumed.push(full);
    }
  }

  let text = raw;
  for (const token of consumed) {
    text = text.replace(token, ' ');
  }
  text = text.replace(/\s+/g, ' ').trim();

  return { text, findInput: findInput as Omit<FindInput, 'query' | 'limit'>, clientFilters, raw };
}

/**
 * Inline completions for a partially-typed prefix, e.g. typing `"ap"` or
 * `"app"` offers `"app:"`. 03 §9.2 rule 1: "Typing `app:` offers
 * completions." — this covers the prefix name itself; value-level
 * completion (e.g. `app:jd...` -> `app:jde`) needs the live catalogue and is
 * out of scope for this pure parser.
 */
export function completionsForPartialPrefix(partial: string): FilterPrefix[] {
  const needle = partial.toLowerCase();
  if (needle.length === 0) return [];
  return ALL_FILTER_PREFIXES.filter((p) => p.startsWith(needle));
}
