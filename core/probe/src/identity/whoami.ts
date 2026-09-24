// MCPForge — `MCPFORGE_PROBE_WHOAMI`: the probe-time identity check. 02 §3.5,
// 02 §4.5, 01 §8 R1/R2. W0-H5.
//
// TWO MECHANISMS, ONE QUESTION, DIFFERENT MOMENTS — do not conflate them:
//
//   * RUNTIME (W0-H3, `adapters/function/identity.ts`): `binding.identity.echoOn`
//     composes a final step onto every WRITE orchestration returning the
//     executing user, and the gateway asserts it matches THE CALLER on THAT
//     CALL, writing `target_identity_observed` / `identity_match` to the audit
//     row. It answers "did this particular call act as this particular human?"
//
//   * PROBE-TIME (this file): once per probe run, MCPForge authenticates as a
//     DESIGNATED TEST USER and calls a dedicated, parameterless probe binding
//     that takes no business action at all. It answers a structural question —
//     "does this binding's identity plumbing carry a per-user identity AT ALL,
//     or does everything silently land as a shared account?" — and its answer
//     is what decides whether the tool may be published.
//
// The runtime echo cannot answer the probe-time question, because it only ever
// runs on a call the gateway already decided to allow. That is R1/R2's whole
// point: "the gateway must refuse to mark any tool identity-carrying without
// probe evidence" (01 §8 R1). This file is the evidence.
//
// READ-ONLY BY CONSTRUCTION: `MCPFORGE_PROBE_WHOAMI` is a fixed literal below.
// It is never composed from a tool's `binding.ref`, never taken from a caller
// argument, and takes no inputs — so there is no shape of this dispatch that
// can reach a business orchestration.

import type { IdentityCarriage } from './carriage.js';

/**
 * 02 §3.5, named once for the whole repository:
 *
 *   "Every `function`-binding application must expose one probe binding,
 *    authored by the module steward as part of enablement:
 *    `MCPFORGE_PROBE_WHOAMI` (JDE orchestration), an equivalent Siebel business
 *    service method returning `LoginName`, an Essbase session-context query. It
 *    takes no parameters and returns the identity of the context it actually
 *    executed under."
 *
 * `core/probe/src/run/function-executor.ts` re-exports this constant under the
 * name it already published, so there is exactly one string literal.
 */
export const PROBE_WHOAMI_ORCHESTRATION = 'MCPFORGE_PROBE_WHOAMI';

/**
 * The response keys the probe will read an identity out of, in order.
 *
 * A CLOSED, ORDERED list rather than "any string field", because a lenient
 * reader is how a probe accidentally reports `verified` off some unrelated
 * echoed field. `identity` is MCPForge's own canonical key (the shape the
 * steward is asked to author); `LoginName` is 02 §3.5's named Siebel form;
 * `user` / `username` / `principal` are the two Oracle target conventions the
 * JDE and Essbase equivalents return. Anything else reads as NO identity —
 * i.e. `unverified` — never as a pass.
 */
export const WHOAMI_IDENTITY_KEYS = [
  'identity',
  'LoginName',
  'user',
  'username',
  'principal',
] as const;

/**
 * What the probe binding did. A closed union, so "no answer" cannot be
 * confused with "an answer that did not match" — they are different verdicts
 * (`unverified` vs `no`) with different remediations and different owners.
 */
export type WhoamiOutcome =
  /** The binding answered and named an identity. */
  | { readonly kind: 'observed'; readonly observed: string }
  /** The binding answered, but named no identity in any known key. */
  | { readonly kind: 'unnamed'; readonly reason: string }
  /** The binding is missing, timed out, or errored. */
  | { readonly kind: 'error'; readonly reason: string };

/**
 * Read the identity out of a probe-binding response body.
 *
 * Returns `null` — never a guess — when no known key holds a non-empty string.
 * A `null` here becomes `unverified`, which auto-disables the tool: the
 * fail-closed direction.
 */
export function readWhoamiIdentity(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of WHOAMI_IDENTITY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Everything the carriage decision is allowed to depend on. Nothing else. */
export interface WhoamiComparisonInput {
  readonly toolId: string;
  /**
   * The designated test user the probe authenticated as. REQUIRED and
   * non-empty — there is no default identity in this codebase
   * (non-negotiable #1), and an empty expectation would make every observation
   * compare equal to nothing and pass.
   */
  readonly testIdentity: string;
  readonly outcome: WhoamiOutcome;
}

export interface WhoamiComparison {
  readonly carries: IdentityCarriage;
  /** What the target said executed the call; `null` when it said nothing. */
  readonly observed: string | null;
  /** The designated test user, echoed so the report is self-describing. */
  readonly expected: string;
  /** Never empty. Reaches the probe report and the enablement backlog. */
  readonly detail: string;
}

/**
 * Compare identities case-insensitively after trimming.
 *
 * Oracle targets normalise usernames to upper case in some paths and preserve
 * the authenticated case in others, so a case-sensitive compare would report a
 * FALSE `no` — "a service account came back" — for a correctly configured SSO
 * instance, which is a worse failure than it looks: it wrongly disables a
 * working write tool and sends a team hunting a service account that does not
 * exist. Nothing weaker than this is done: no prefix matching, no domain
 * stripping, no `startsWith`.
 */
function sameIdentity(a: string, b: string): boolean {
  return a.trim().toLocaleUpperCase() === b.trim().toLocaleUpperCase();
}

/**
 * 02 §3.5's three branches, and only those three. A PURE function of the
 * observation: same inputs, same verdict, no clock, no environment, no
 * override parameter. `verified` is reachable from exactly one branch.
 */
export function compareWhoami(input: WhoamiComparisonInput): WhoamiComparison {
  const expected = input.testIdentity.trim();

  // Guarded first, because every later branch is meaningless without it. An
  // absent expectation is the probe's own misconfiguration, and it fails the
  // tool closed rather than passing it vacuously.
  if (expected.length === 0) {
    return {
      carries: 'unverified',
      observed: null,
      expected: '',
      detail:
        `no designated probe test identity was configured, so ${PROBE_WHOAMI_ORCHESTRATION}'s answer for ` +
        `${input.toolId} could not be compared against anything. There is no default identity in MCPForge.`,
    };
  }

  if (input.outcome.kind === 'error') {
    return {
      carries: 'unverified',
      observed: null,
      expected,
      detail:
        `${PROBE_WHOAMI_ORCHESTRATION} is missing or errored: ${input.outcome.reason}. ` +
        `Identity carriage is unverified — never assumed fine (02 §3.5).`,
    };
  }

  if (input.outcome.kind === 'unnamed') {
    return {
      carries: 'unverified',
      observed: null,
      expected,
      detail:
        `${PROBE_WHOAMI_ORCHESTRATION} responded but named no identity (${input.outcome.reason}). ` +
        `Expected one of: ${WHOAMI_IDENTITY_KEYS.join(', ')}. Identity carriage is unverified.`,
    };
  }

  const observed = input.outcome.observed.trim();
  if (sameIdentity(observed, expected)) {
    return {
      carries: 'verified',
      observed,
      expected,
      detail:
        `${PROBE_WHOAMI_ORCHESTRATION} reported the call executed as ${observed}, matching the designated ` +
        `probe test identity ${expected}. This binding carries the caller's identity.`,
    };
  }

  return {
    carries: 'no',
    observed,
    expected,
    detail:
      `${PROBE_WHOAMI_ORCHESTRATION} reported the call executed as ${observed}, not as the designated probe ` +
      `test identity ${expected}. A shared or service account is executing this binding, so it does not ` +
      `carry the caller's identity (02 §3.5, 01 §8 R1).`,
  };
}
