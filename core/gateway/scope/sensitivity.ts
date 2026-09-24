// MCPForge — the sensitivity ordering used by `ConsumerAuthorized`. W0-E2.
//
// FLAGGED DECISION (CLAUDE.md §8). 02 §11.3 requires "tools whose `sensitivity`
// is at or below its `maxSensitivity`", and 02 §4.3 gives a role a
// `sensitivityCeiling` — both of which need a TOTAL ORDER over the five
// sensitivity classes. **No document in `docs/build-plan/` states that order.**
// The only ordering the documents ever present is the declaration order of the
// list itself, written identically in 02 §2.2, 02 §5.1's facet table and 03
// §'s filter control:
//
//     public | internal | confidential | financial | personal
//
// This module adopts that declaration order as the rank, because a ceiling
// check cannot be implemented without one and inventing a different order would
// be a worse answer than adopting the documents' own consistent presentation.
// It is nonetheless a **security-relevant semantic with a blast radius beyond
// this module** — policy-chain stage 6e (W0-E3) reads the same order, and
// whether `personal` really outranks `financial` is a governance question, not
// an implementation detail. A human must confirm it. It lives in exactly one
// exported function so that confirmation changes one line, not five call sites.

import { SENSITIVITIES } from '@mcpforge/shared';

const RANK: ReadonlyMap<string, number> = new Map(SENSITIVITIES.map((s, i) => [s, i]));

/**
 * The rank of a sensitivity class; higher means more restricted.
 *
 * An unrecognised value returns `null`, and every caller treats `null` as
 * "refuse" — a ceiling or a class this build does not understand must never
 * compare as permissive.
 */
export function sensitivityRank(value: string): number | null {
  return RANK.get(value) ?? null;
}

/**
 * Is `sensitivity` at or below `ceiling`? Fail-closed: an unknown value on
 * either side is `false`.
 */
export function sensitivityWithinCeiling(sensitivity: string, ceiling: string): boolean {
  const s = sensitivityRank(sensitivity);
  const c = sensitivityRank(ceiling);
  if (s === null || c === null) return false;
  return s <= c;
}
