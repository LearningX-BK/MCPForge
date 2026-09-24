// MCPForge — `kind: Role`. 02 §4.3, plus the Phase 5 `bindingGrants` (02 §11.4).
//
// A role is a GRANT plus a narrowing lens. It has no runtime, no orchestration,
// no composite tools and no execution order (02 §4.3).

import type { BindingType, IsoDate, ManifestBase, Sensitivity, ToolId } from './common.js';

export const SOD_DISPOSITIONS = ['warn-and-require-exception', 'block', 'warn'] as const;
export type SodDisposition = (typeof SOD_DISPOSITIONS)[number];

export interface SegregationOfDutiesRule {
  readonly conflict: readonly ToolId[];
  readonly disposition: SodDisposition;
}

/**
 * Phase 5, 02 §11.4. Being in scope is NOT permission to execute an elevated
 * binding (CLAUDE.md non-negotiable #7). An elevated binding needs an explicit,
 * named, EXPIRING, approval-recorded grant here — scope membership is never
 * sufficient. Compiled into the role's scope artefact so widening a binding
 * grant is as visible in a diff as widening a role.
 */
export interface BindingGrant {
  readonly bindingType: BindingType;
  /**
   * For `plsql`, the wrapper package (`MCPFORGE_WRAP.<PKG>`); for `function`,
   * the orchestration family. Reconciled against the database-side EXECUTE
   * grant by the probe (02 §11.4.3).
   */
  readonly names?: readonly string[];
  /** The approval record in `approvals/` that issued this grant. */
  readonly approvalRef: string;
  readonly approver: string;
  /** Grants expire — default 180 days. Renewal is a re-approval (02 §11.4). */
  readonly expiresAt: IsoDate;
  /**
   * A recorded, expiring, named-approver decision that this role may execute
   * this binding type's writes through the ordinary plan -> confirm path
   * without a per-call human approval (02 §11.4.4). It removes NOTHING else:
   * plan -> confirm, guardrails, SoD and the identity requirement all still run.
   */
  readonly standingAuthorization?: string;
}

export interface RoleManifest extends ManifestBase<'Role'> {
  readonly label: string;
  readonly description: string;
  /** Globs, compiled by codegen into an explicit tool-id list (02 §4.3). */
  readonly includes: readonly string[];
  readonly excludes?: readonly string[];
  readonly sensitivityCeiling: Sensitivity;
  readonly writeAllowed: boolean;
  /** The resident set. Counts against `budgetTokens`. */
  readonly coreTools: readonly ToolId[];
  /** CI-enforced ceiling on the resident set — 1300 (02 §5.3(d)). */
  readonly budgetTokens: number;
  readonly segregationOfDuties?: readonly SegregationOfDutiesRule[];
  readonly mutuallyExclusiveWith?: readonly string[];
  /** Phase 5 (02 §11.4). */
  readonly bindingGrants?: readonly BindingGrant[];
}
