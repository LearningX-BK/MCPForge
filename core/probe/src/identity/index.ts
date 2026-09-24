// MCPForge — `core/probe/identity/**`. 02 §3.5, 02 §4.5, 01 §8 R1/R2. W0-H5.
//
// THE GOVERNANCE-EXCEPTION ROUTE, stated here because its absence from the code
// is the point of the module:
//
// There is NO manual override in this package. No function exported below takes
// a `force`, `override`, `assumeVerified`, `skipIdentity` or equivalent
// argument; `compareWhoami` and `constrainForCarriage` are pure functions of a
// probe observation and four manifest-declared facts, and `no-override.test.ts`
// asserts that mechanically rather than by convention. A deployment that must
// publish a tool in spite of its verdict takes the governance route MCPForge
// already has and does not get a second one:
//
//   * `policyException` on the tool manifest, carrying an `approvalRef` into
//     `approvals/` — the same reviewed, git-borne, approval-recorded artefact
//     every other grant here uses (`common.schema.json`'s `approvalRef`,
//     CLAUDE.md #7). A tool carrying a `policyException` is ELEVATED POSTURE by
//     non-negotiable #7, so publishing it still needs a named, expiring,
//     approval-recorded `bindingGrant`; the exception buys a review, not a pass.
//
// FLAGGED FOR A HUMAN (CLAUDE.md §8): `approvals/` is empty in this repository
// and no task has yet fixed the FILE SHAPE of an approval record — only its
// reference form (`approvalRef: approvals/<file>`) is settled, by
// `common.schema.json` and `core/shared/src/manifest/role.ts`. This task
// therefore does NOT invent an approval-record schema for an identity
// exception; inventing one has real blast radius (every rule, portal screen and
// CI gate that later reads approvals would inherit it). The absence of an
// override path is implemented and tested here; the exception artefact's shape
// stays open.

export {
  IDENTITY_CARRIAGES,
  NON_CARRIAGE_DISPOSITIONS,
  DEFAULT_NON_CARRIAGE_DISPOSITION,
  LOW_SENSITIVITY_CEILING,
  isIdentityCarriage,
  isNonCarriageDisposition,
  isLowSensitivity,
} from './carriage.js';
export type { IdentityCarriage, NonCarriageDisposition } from './carriage.js';

export {
  PROBE_WHOAMI_ORCHESTRATION,
  WHOAMI_IDENTITY_KEYS,
  readWhoamiIdentity,
  compareWhoami,
} from './whoami.js';
export type { WhoamiComparison, WhoamiComparisonInput, WhoamiOutcome } from './whoami.js';

export { constrainForCarriage } from './constrain.js';
export type { ConstraintInput, IdentityConstraint } from './constrain.js';

export { assessIdentity, identityCarriesBoolean } from './assess.js';
export type { AssessIdentityInput, ToolIdentityReport } from './assess.js';
