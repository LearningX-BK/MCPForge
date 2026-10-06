// MCPForge — W0-Q5: the `requests/<id>.request.yaml` file. Pure (no fs), so the
// client form, the server loader and the tests share one definition.
//
// Format: docs/build-plan/w0-q4-intake-requests.md §1. A request is NOT a
// manifest: it grants nothing, binds nothing, is never read by codegen or the
// gateway. Status is DERIVED (./derive-state.ts) except `declined`/`withdrawn`.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

export const REQUEST_ID_PATTERN = /^req-\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/;

export const requestPath = (id: string): string => `requests/${id}.request.yaml`;
/** The branch a submission lands on. Stable per request. */
export const requestBranch = (id: string): string => `forge/${id}`;
/** The branch Build's Save draft uses for a tool id (`draft-editor.tsx`'s `branchFor`). */
export const draftBranchForTool = (toolId: string): string =>
  `forge/build-${toolId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

const matchSchema = z.object({ toolId: z.string().min(1), score: z.number() });

export const requestSchema = z.object({
  apiVersion: z.literal('mcpforge/v1'),
  kind: z.literal('Request'),
  id: z.string().regex(REQUEST_ID_PATTERN),
  /** `Principal.subject`. Never defaulted (non-negotiable 1). */
  requestedBy: z.string().min(1),
  requestedAt: z.string().min(1),
  ask: z.string().min(1),
  business: z.object({
    does: z.string().min(1),
    app: z.string().min(1),
    module: z.string().min(1),
    access: z.enum(['read', 'write']),
    inputs: z.array(z.string()).default([]),
    goodAnswer: z.string().default(''),
    whoMayRun: z.string().default(''),
  }),
  /** Snapshot at submit time, so a later gate can tell a stale verdict (note §5). */
  verdictAtSubmit: z.object({
    tier: z.enum(['exists', 'near_miss', 'new']),
    indexDigest: z.string().min(1),
    matches: z.array(matchSchema),
    decision: z
      .union([
        z.object({ kind: z.literal('merge'), into: z.string().min(1) }),
        z.object({ kind: z.literal('justify'), text: z.string().min(1) }),
      ])
      .optional(),
  }),
  /** The triager's half. Absent until triage. */
  governance: z
    .object({
      owner: z.string().min(1),
      steward: z.string().min(1),
      sensitivity: z.string().min(1),
      processTag: z.string().default(''),
      expectedVolume: z.string().default(''),
      intendedToolId: z.string().regex(TOOL_ID_PATTERN),
      server: z.string().min(1),
    })
    .optional(),
  /** The only two stored states: they have no other artefact (note §1). */
  closed: z
    .object({
      state: z.enum(['declined', 'withdrawn']),
      by: z.string().min(1),
      at: z.string().min(1),
      reason: z.string().min(1),
    })
    .optional(),
});
export type RequestFile = z.infer<typeof requestSchema>;

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
