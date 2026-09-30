// MCPForge — W0-P3f: what the approver is told about guardrails. Server-only.
//
// Owner decision, 30 Sep 2026: the gateway's guardrail stage records only
// "breached or not", never a per-rule value. So the approver sees the tool's
// DECLARED guardrails, read from its committed manifest at the request's own
// tool version, each marked as passed. That is a fact, not a hope: stage 6f
// runs before 6g, and a breach refuses the plan before any approval is raised.
// The value that was checked is stated as not recorded, never reconstructed.
//
// A different committed version means the declarations may differ from the
// ones enforced, so nothing is listed and the caller says why.

import { loadManifestFiles } from '@mcpforge/codegen/validate';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { GuardrailResultView } from '@/components/write-path';

/** Shown in place of a value the gateway does not record. */
export const VALUE_NOT_RECORDED =
  'Not recorded: checked when the plan was made, and it passed or no approval would exist.';

type Declared = Readonly<Record<string, unknown>> & { readonly kind?: unknown };

function describe(g: Declared): string {
  const field = typeof g['field'] === 'string' ? g['field'] : undefined;
  switch (g.kind) {
    case 'maxNumeric':
      return `${field ?? 'value'} at most ${String(g['value'])}`;
    case 'minNumeric':
      return `${field ?? 'value'} at least ${String(g['value'])}`;
    case 'allowedValues':
      return `${field ?? 'value'} is one of ${Array.isArray(g['values']) ? g['values'].join(', ') : 'the declared list'}`;
    case 'sodConflict':
      return `separation of duties with ${String(g['with'])}${typeof g['scope'] === 'string' ? ` (${g['scope']})` : ''}`;
    case 'rateLimit':
      return `rate limit${typeof g['count'] === 'number' ? ` of ${g['count']}` : ''}${typeof g['windowMinutes'] === 'number' ? ` per ${g['windowMinutes']} minutes` : ''}`;
    case 'timeWindow':
      return 'allowed time window';
    default:
      return String(g.kind);
  }
}

export type GuardrailFacts =
  | { readonly kind: 'declared'; readonly results: readonly GuardrailResultView[] }
  | { readonly kind: 'version-unknown' };

/** The declared guardrails of `toolId` at `toolVersion`, as passed-at-plan rows. */
export function declaredGuardrails(
  toolId: string,
  toolVersion: string | null,
  repoRoot: string = resolveRepoRoot(),
): GuardrailFacts {
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as
      | {
          kind?: unknown;
          id?: unknown;
          version?: unknown;
          writeSafety?: { guardrails?: unknown } | null;
        }
      | null
      | undefined;
    if (doc?.kind !== 'Tool' || doc.id !== toolId) continue;
    if (toolVersion === null || doc.version !== toolVersion) return { kind: 'version-unknown' };
    const list = Array.isArray(doc.writeSafety?.guardrails)
      ? (doc.writeSafety.guardrails as Declared[])
      : [];
    return {
      kind: 'declared',
      results: list.map((g, i) => ({
        id: `${String(g.kind)}-${i}`,
        label: describe(g),
        passed: true,
        valueChecked: VALUE_NOT_RECORDED,
      })),
    };
  }
  return { kind: 'version-unknown' };
}
