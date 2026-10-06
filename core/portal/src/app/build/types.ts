// MCPForge — W0-J14: Build data shapes (03 §5.3 "Build").
//
// `BuildDraft` is real `ChangeHost` vocabulary (`ChangeProposal.id/title/
// branch/state`) plus the manifest text. Since W0-P3c the pages read drafts
// from the ChangeHost (`./drafts.ts`); `fixtures.ts` is a test source only.
import type { BindingType, ReviewPath } from '@mcpforge/shared';
import type { ChangeState } from '@mcpforge/shared';

/** One manifest draft — a `ChangeProposal` plus the one YAML source of truth. */
export interface BuildDraft {
  readonly id: string;
  readonly title: string;
  readonly branch: string;
  readonly state: ChangeState;
  /** W0-Q3 — a module-server draft carries its server id here and `kind: 'server'`. */
  readonly kind?: 'tool' | 'server' | undefined;
  readonly toolId: string;
  /** The ONLY source of truth for this draft. Every pane derives from this text. */
  readonly yaml: string;
  /**
   * W0-P3c — the repo-relative file this draft was opened from, when it was
   * opened from one (a committed manifest, or a saved draft's manifest). Save
   * draft writes back to it while the id is unchanged. Absent for a new tool.
   */
  readonly manifestPath?: string | undefined;
}

/** The binding-type security-handshake template Build shows once a type is picked (03 §5.3). */
export interface BindingTypeTemplate {
  readonly type: BindingType;
  readonly label: string;
  readonly handshake: string;
  readonly sandboxHarness: string;
  /** True when this binding type structurally forces `governance.reviewPath: standard`. */
  readonly forcesStandardReview: boolean;
}

export const REVIEW_PATH_LABELS: Readonly<Record<ReviewPath, string>> = {
  standard: 'Standard',
  expedited: 'Expedited',
};
