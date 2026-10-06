// MCPForge — W0-Q5: the `requests/<id>.request.yaml` file. Pure (no fs), so the
// client form, the server loader and the tests share one definition.
//
// Format: docs/build-plan/w0-q4-intake-requests.md §1. A request is NOT a
// manifest: it grants nothing, binds nothing, is never read by codegen or the
// gateway. Status is DERIVED (./derive-state.ts) except `declined`/`withdrawn`.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { requestSchema, type RequestFile } from '@mcpforge/shared/request';

// W0-Q5b: the schema lives in core/shared so `forge validate` checks requests
// against the same definition this module parses with. Re-exported unchanged.
export { REQUEST_ID_PATTERN, requestSchema, type RequestFile } from '@mcpforge/shared/request';

export const requestPath = (id: string): string => `requests/${id}.request.yaml`;
/** The branch a submission lands on. Stable per request. */
export const requestBranch = (id: string): string => `forge/${id}`;
/** The branch Build's Save draft uses for a tool id (`draft-editor.tsx`'s `branchFor`). */
export const draftBranchForTool = (toolId: string): string =>
  `forge/build-${toolId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

export type ParseResult =
  | { readonly ok: true; readonly request: RequestFile }
  | { readonly ok: false; readonly message: string; readonly next: string };

export function parseRequestYaml(text: string, path: string): ParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return {
      ok: false,
      message: `${path} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
      next: `Fix the YAML in ${path} through a change proposal.`,
    };
  }
  const r = requestSchema.safeParse(doc);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      message:
        `${path} is not a valid Request: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
      next: `Correct ${path} through a change proposal; the shape is in docs/build-plan/w0-q4-intake-requests.md §1.`,
    };
  }
  return { ok: true, request: r.data };
}

export function requestYaml(request: RequestFile): string {
  return stringifyYaml(request, { lineWidth: 0 });
}

/** `req-<YYYYMMDD>-<slug-of-ask>`; the date is passed in so this stays pure. */
export function newRequestId(ask: string, now: Date): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = ask
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return `req-${date}-${slug.length > 0 ? slug : 'request'}`;
}
