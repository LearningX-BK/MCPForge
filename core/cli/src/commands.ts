// The canonical forge command surface — 02 §8.2's list, as the Wave 0
// `done:` criterion for W0-A5 states it verbatim:
//   new tool · validate · codegen · test · bench · probe · package ·
//   slice-diff · kill · audit verify · audit reverse · identity remap · ci · dev
//
// Extended TWICE, and only for Phase 5 corrections: by W0-N1 with the consumer
// registry surface, and by W0-N6 with `forge secrets status|rotate|revoke`
// (02 §11.5 rules 5 and 6) — both named verbatim in CLAUDE.md §7.
//
// W0-N1's note: with the consumer registry surface CLAUDE.md §7
// names: `forge consumer new|list|show|suspend|rotate|retire` and
// `forge consumer issue-credential`. That is an addition the Phase 5
// correction (02 §11.2) requires, not a re-opening of W0-A5's list.
//
// This is the single source of truth: `program.ts` builds the Commander
// tree from it, and the test suite walks it too, so the two can never
// silently drift apart.

export interface StubCommandSpec {
  /** Argv path, e.g. ['audit', 'verify'] for `forge audit verify`. */
  readonly path: readonly string[];
  readonly description: string;
}

export const CANONICAL_COMMANDS: readonly StubCommandSpec[] = [
  { path: ['new', 'tool'], description: 'Scaffold a new Tool manifest from answers (02 §2.1).' },
  {
    path: ['validate'],
    description: '~40 schema + policy rules against every manifest (02 §2.2, §11.3).',
  },
  {
    path: ['codegen'],
    description: 'Regenerate generated/ from the manifests, deterministically (02 §2.3).',
  },
  {
    path: ['test'],
    description: 'Run the generated and hand-written test suites (02 §2.3, §7.3).',
  },
  {
    path: ['bench'],
    description: 'Run the discovery benchmark harness — TTFC, VTC, DH, SA@1, MTB (02 §5.9).',
  },
  { path: ['probe'], description: 'Run the capability probe against a live instance (02 §4.5).' },
  {
    path: ['package'],
    description: 'Build a slice artefact — selection only, never a fork (02 §6.4).',
  },
  { path: ['slice-diff'], description: 'Diff two slice artefacts — the no-fork proof (02 §6.4).' },
  {
    path: ['kill'],
    description:
      'Kill-switch a tool, server, binding type, consumer or deployment (02 §4.7, §11.4).',
  },
  {
    path: ['audit', 'verify'],
    description: 'Walk the audit hash chain; report the first broken row, if any (02 §10.4).',
  },
  {
    path: ['audit', 'reverse'],
    description: 'Construct the reversing call for a completed call id (02 §3.1.4).',
  },
  {
    path: ['identity', 'remap'],
    description: 'Rewrite local-subject to new-subject correspondences (02 §4.4).',
  },
  // W0-N1. The consumer registry (02 §11.2, 05 §1.3) — CLAUDE.md §7 names
  // this surface verbatim: `forge consumer new|list|show|suspend|rotate|retire`
  // plus `forge consumer issue-credential <id>`. Registration is a git
  // artefact and an approval record; Dynamic Client Registration does not exist.
  {
    path: ['consumer', 'new'],
    description:
      'Stage a change proposal registering a new consumer (02 §11.2). Writes nothing to consumers/.',
  },
  {
    path: ['consumer', 'list'],
    description: 'List every registered consumer and its effective status.',
  },
  {
    path: ['consumer', 'show'],
    description: 'Show one consumer record — credential REFERENCE only, never a value.',
  },
  {
    path: ['consumer', 'suspend'],
    description:
      'Stage a change proposal suspending a consumer. For an immediate cut-off use "forge kill consumer:<id>".',
  },
  {
    path: ['consumer', 'rotate'],
    description:
      "Stage a change proposal recording a rotation of the consumer's client credential schedule.",
  },
  {
    path: ['consumer', 'retire'],
    description: 'Stage a change proposal retiring a consumer. The id is never reused.',
  },
  {
    path: ['consumer', 'issue-credential'],
    description:
      'Mint the client credential and print it exactly once. Refused when CI=true or --env is staging or prod.',
  },
  // W0-N6. The secrets surface CLAUDE.md §7 names verbatim:
  // `forge secrets status|rotate|revoke`. Added on exactly the precedent
  // W0-N1 set above — a Phase 5 correction (02 §11.5 rules 5 and 6) requires
  // it, which is not the same as re-opening W0-A5's canonical list.
  {
    path: ['secrets', 'status'],
    description:
      'Age, interval and next-due for every secretRef. Exits non-zero past 2x an interval (02 §11.5 rule 5).',
  },
  {
    path: ['secrets', 'rotate'],
    description:
      'Rotate a credential. The gateway signing keys keep a dual-key overlap window — the retired key verifies, never signs.',
  },
  {
    path: ['secrets', 'revoke'],
    description:
      'Invalidate a credential AND kill-switch every dependent, in one act (02 §11.5 rule 6).',
  },
  { path: ['ci'], description: 'Run the whole CI pipeline locally, host-agnostic (02 §7.2).' },
  {
    path: ['dev'],
    description: 'Run the gateway (and, once it exists, the portal) in local dev mode (02 §10.3).',
  },
] as const;

/** `forge audit verify` -> "audit verify" */
export function commandLabel(spec: StubCommandSpec): string {
  return spec.path.join(' ');
}

/** The full surface as one line, exactly as TASKS.md's W0-A5 `done:` states it. */
export const CANONICAL_SURFACE_LINE = CANONICAL_COMMANDS.map(commandLabel).join(' · ');
