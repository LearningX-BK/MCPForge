// MCPForge — the `runtime_flags` repository's types. W0-E5, 02 §4.7 as
// extended by 02 §11.2.
//
// `KillScope` and the agent-facing `RuntimeFlag` shape are already owned by
// `core/gateway/scope/types.ts` (W0-E2) — this module does not redeclare
// them, it imports them, so a row this repository returns can be handed
// straight to `RuntimeFlagSource.activeFlags()` with no second shape to keep
// in sync.

import type { KillScope } from '../../scope/types.js';

/**
 * One stored `runtime_flags` row. Deliberately NOT an extension of
 * `RuntimeFlag` (`../../scope/types.js`): that interface's `until` is a
 * `Date`, because the predicate that reads it compares against `ctx.now`
 * (also a `Date`); this row's `until` is the ISO-8601 UTC string the column
 * actually holds (`schema/spec.ts`'s `timestamp` kind). `../../flags/poller.ts`
 * is the one place that converts one into the other, on every poll — exactly
 * the seam `RuntimeFlagSource` exists to be on the other side of.
 */
export interface StoredRuntimeFlag {
  readonly id: string;
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
  readonly until: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly auditCallId: string | null;
  /** Soft-clear. A row with `active: false` is never returned as an active flag. */
  readonly active: boolean;
}

export interface CreateRuntimeFlagInput {
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
  /** `null` or omitted — indefinite. */
  readonly until?: string | null;
  readonly createdBy: string;
  readonly auditCallId?: string | null;
  readonly now?: string;
}

export interface RuntimeFlagsRepository {
  /** Append one flag row. There is no update — see `../schema/spec.ts`. */
  create(input: CreateRuntimeFlagInput): Promise<StoredRuntimeFlag>;
  get(id: string): Promise<StoredRuntimeFlag | undefined>;
  /**
   * Every row with `active = true`, regardless of `until` — expiry is a
   * property of *time*, evaluated by `isFlagActive` at read time
   * (`../../scope/sources.ts`), not a property the repository decides by
   * comparing to its own clock. Returning every `active` row and letting the
   * poller apply `isFlagActive` keeps exactly one place that decides "is this
   * flag in force now".
   */
  listActive(): Promise<StoredRuntimeFlag[]>;
  /** Soft-clear: flips `active` to `false`. Never deletes — 02 §4.7's history. */
  clear(id: string, now?: string): Promise<StoredRuntimeFlag | undefined>;
}
