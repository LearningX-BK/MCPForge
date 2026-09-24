// MCPForge — one tool's identity assessment, as it appears in the probe
// report. 02 §3.5, 02 §4.5. W0-H5.
//
// This is the block the portal's Application Enablement page and `forge.find`'s
// disabled-tool card read. It exists as a STRUCTURED block rather than only the
// boolean `identityCarries` of 02 §4.5's worked example because the document's
// own verdict is a TRI-state (`verified | no | unverified`) and a boolean
// cannot hold three values without collapsing two of them. `identityCarries` is
// kept, unchanged and required, so the artefact still matches §4.5 field for
// field; `identity.carries` is where the third value lives.

import type { IdentityCarriage, NonCarriageDisposition } from './carriage.js';
import { constrainForCarriage, type IdentityConstraintStatus } from './constrain.js';
import { PROBE_WHOAMI_ORCHESTRATION } from './whoami.js';

/** The tool-level `identity` block of a probe report entry. */
export interface ToolIdentityReport {
  /** NON-NEGOTIABLE #2's value. Written here, into this artefact, and nowhere else. */
  readonly carries: IdentityCarriage;
  /** The probe binding that was called. Always `MCPFORGE_PROBE_WHOAMI` at Wave 0. */
  readonly probeBinding: string;
  /** The designated test user the probe authenticated as; `null` if none was configured. */
  readonly testIdentity: string | null;
  /** The identity the target reported executing under; `null` when it named none. */
  readonly observedIdentity: string | null;
  /** The `onServiceAccount` disposition actually applied, after fail-closed defaulting. */
  readonly disposition: NonCarriageDisposition;
  /** The status this verdict forced, or `null` when it forced none. */
  readonly constrainedTo: IdentityConstraintStatus | null;
  /** True when the verdict alone auto-disables the tool. */
  readonly autoDisabled: boolean;
  /** Never empty. The evidence sentence: what was observed and what was applied. */
  readonly detail: string;
}

export interface AssessIdentityInput {
  readonly toolId: string;
  readonly write: boolean;
  readonly carries: IdentityCarriage;
  readonly testIdentity: string | null;
  readonly observedIdentity: string | null;
  readonly onNonCarriage?: string | null | undefined;
  readonly sensitivity?: string | null | undefined;
  /** The whoami comparison's own sentence, prefixed to the constraint's. */
  readonly evidence?: string | null | undefined;
}

/**
 * Combine the verdict with the automatic constraint. Pure — no clock, no
 * environment, no override argument (see `no-override.test.ts`).
 */
export function assessIdentity(input: AssessIdentityInput): ToolIdentityReport {
  const constraint = constrainForCarriage({
    toolId: input.toolId,
    carries: input.carries,
    write: input.write,
    onNonCarriage: input.onNonCarriage ?? null,
    sensitivity: input.sensitivity ?? null,
  });

  const evidence = input.evidence?.trim();
  const detail =
    evidence && evidence.length > 0 ? `${evidence} ${constraint.detail}` : constraint.detail;

  return {
    carries: input.carries,
    probeBinding: PROBE_WHOAMI_ORCHESTRATION,
    testIdentity: input.testIdentity,
    observedIdentity: input.observedIdentity,
    disposition: constraint.disposition,
    constrainedTo: constraint.status,
    autoDisabled: constraint.disabled,
    detail,
  };
}

/**
 * The §4.5 worked-example boolean, derived from the tri-state so the two can
 * never disagree. `unverified` maps to `null`: "nothing established it either
 * way" is precisely what `unverified` means, and mapping it to `false` would
 * assert a service account the probe never saw.
 */
export function identityCarriesBoolean(carries: IdentityCarriage): boolean | null {
  switch (carries) {
    case 'verified':
      return true;
    case 'no':
      return false;
    case 'unverified':
      return null;
  }
}
