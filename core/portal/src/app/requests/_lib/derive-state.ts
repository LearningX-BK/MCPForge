// MCPForge — W0-Q5: a request's lifecycle state, DERIVED from real artefacts.
// Note §3 (docs/build-plan/w0-q4-intake-requests.md). Pure: the loader gathers
// the facts, this decides. The only stored states are `declined`/`withdrawn`.
//
// `enabled`, not `merged`, is terminal (03 §5.3): a merged manifest the probe
// reports disabled is not a delivered capability.

import type { RequestFile } from './request-file';

export type DerivedState =
  | 'submitted'
  | 'triaged'
  | 'drafted'
  | 'in_review'
  | 'merged'
  | 'enabled'
  | 'declined'
  | 'withdrawn';

export const DERIVED_LIFECYCLE: readonly DerivedState[] = [
  'submitted',
  'triaged',
  'drafted',
  'in_review',
  'merged',
  'enabled',
];

export const DERIVED_LABELS: Readonly<Record<DerivedState, string>> = {
  submitted: 'Submitted',
  triaged: 'Triaged',
  drafted: 'Drafted',
  in_review: 'In review',
  merged: 'Merged',
  enabled: 'Enabled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/** Change states (03 §6.1) that are still the author's, not yet under review. */
const DRAFTING_STATES: readonly string[] = ['draft', 'validating', 'invalid'];

/** Everything derivation reads, gathered by the loader from existing artefacts. */
export interface RequestFacts {
  /** The request file's own change is still an open proposal (not on the default branch yet). */
  readonly submissionOpen: boolean;
  /** `ChangeState` of the open proposal carrying the tool's manifest, if any. */
  readonly draftProposalState: string | undefined;
  /** The tool's manifest exists on the default branch. */
  readonly manifestMerged: boolean;
  /** An `approvals/` record names the tool id. */
  readonly approvalRecorded: boolean;
  /** `generated/index` lists the tool. */
  readonly inIndex: boolean;
  /** The latest probe report's status for the tool, if it has one. */
  readonly probeStatus: string | undefined;
}

export interface Derivation {
  readonly state: DerivedState;
  /** When `merged` but not `enabled`: what it is waiting on, in plain words. */
  readonly blocker: string | null;
}

export function deriveRequestState(request: RequestFile, facts: RequestFacts): Derivation {
  if (request.closed !== undefined) return { state: request.closed.state, blocker: null };
  const g = request.governance;
  if (facts.submissionOpen || g === undefined) return { state: 'submitted', blocker: null };

  if (facts.manifestMerged && facts.approvalRecorded) {
    const probeOk = facts.probeStatus !== undefined && !facts.probeStatus.startsWith('disabled');
    if (facts.inIndex && probeOk) return { state: 'enabled', blocker: null };
    return {
      state: 'merged',
      blocker:
        facts.probeStatus === undefined
          ? `Merged, but the capability probe has not reported on ${g.intendedToolId} yet. ${g.owner} runs the probe against a live instance.`
          : `Merged, but the probe reports ${g.intendedToolId} as ${facts.probeStatus}. Waiting on ${g.owner}.`,
    };
  }
  if (facts.draftProposalState !== undefined) {
    return {
      state: DRAFTING_STATES.includes(facts.draftProposalState) ? 'drafted' : 'in_review',
      blocker: null,
    };
  }
  return { state: 'triaged', blocker: null };
}
