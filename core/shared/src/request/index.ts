// MCPForge — the `Request` artefact schema (`requests/<id>.request.yaml`).
//
// Format: docs/build-plan/w0-q4-intake-requests.md §1. A request is NOT a
// manifest: it grants nothing, binds nothing, is never read by codegen or the
// gateway, and never appears in `generated/`. Status is DERIVED except the two
// terminal states `declined`/`withdrawn`.
//
// W0-Q5b: this schema moved here VERBATIM from the portal
// (`core/portal/src/app/requests/_lib/request-file.ts`, which re-exports it) so
// that `forge validate` (core/codegen) and the portal parse a request against
// ONE definition. Codegen cannot import the portal (the portal depends on
// codegen), and core/shared already holds the other zod contract both sides
// share (`./api/v1`). It is zod, not JSON Schema, because a Request is not a
// manifest: the "no zod in core/shared/manifest" note does not apply here.
//
// The closed conventions (the 19-verb tool-id pattern, no secrets, no `calls`,
// no stored derived state, file name = id) are `forge validate` POLICY rules
// layered over this shape — core/codegen/src/rules/requests.ts — exactly as the
// manifest policy rules layer over the Ajv schema. Nothing here relaxes them.

import { z } from 'zod';

export const REQUEST_ID_PATTERN = /^req-\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Four lower-snake segments. The closed verb list is enforced by `forge validate`. */
const TOOL_ID_SHAPE = /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/;

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
      intendedToolId: z.string().regex(TOOL_ID_SHAPE),
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

/** The only lifecycle states a request file may store (note §1, D3). */
export const STORED_REQUEST_STATES = ['declined', 'withdrawn'] as const;
