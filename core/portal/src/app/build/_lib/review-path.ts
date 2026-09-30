// MCPForge — W0-J14: whether `governance.reviewPath: expedited` is
// selectable for a given binding type.
//
// Reuses the REAL policy rule's own set (`policy.expedited-review-elevated-
// binding`, `core/codegen/src/rules/binding.ts`) rather than re-typing
// `['plsql', 'function']` a second time — that export is this task's one
// addition to `core/codegen` (a one-line export, not a new rule), made so the
// UI's "expedited is structurally unavailable" check and `forge validate`'s
// own rejection can never drift apart (02 §2.2, CLAUDE.md non-negotiable #7).
// Imported from the dedicated fs-free subpath, not the `@mcpforge/codegen/rules`
// barrel — that barrel pulls in `node:fs` (manifest/approval scanning for the
// OTHER policy rules) and this file runs client-side. See
// `core/codegen/src/rules/elevated-binding-types.ts`.
import { ELEVATED_BINDING_TYPES } from '@mcpforge/codegen/rules/elevated-binding-types';
import type { BindingType } from '@mcpforge/shared';

export interface ExpeditedReviewGate {
  readonly available: boolean;
  /** Present only when `available` is false — the amber note's text. */
  readonly reason?: string;
}

/**
 * 03 §5.3: "`plsql` and `function` structurally unable to select expedited
 * review, and the reason stated in an amber note rather than a disabled
 * control with no explanation." The reason text below is the same fact the
 * policy rule's own `fail(...)` message states (binding.ts), worded for a
 * human reading the Build form rather than a validate report.
 */
export function expeditedReviewGate(bindingType: BindingType | undefined): ExpeditedReviewGate {
  if (bindingType === undefined || !ELEVATED_BINDING_TYPES.has(bindingType)) {
    return { available: true };
  }
  return {
    available: false,
    reason: `Expedited review is structurally unavailable for a ${bindingType} binding. ${
      bindingType === 'plsql' ? 'PL/SQL' : 'Function'
    } bindings are elevated posture (CLAUDE.md non-negotiable #7, 02 §11.4) — executing one always needs the standard review path, never a shorter one. If the change is genuinely low risk, that is an argument for a smaller change, not a faster review.`,
  };
}
