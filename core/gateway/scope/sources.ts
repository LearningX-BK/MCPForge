// MCPForge — the two runtime seams' Wave 0 read-side implementations. W0-E2.
//
// Both are trivial by design. They exist so `ProbeEnabled` and `¬KillSwitched`
// are REAL predicates in the intersection today, evaluated against a real
// interface, rather than constants that a later task has to thread back in.
// Neither of them invents an artefact:
//
//   * `staticProbeStatuses` takes a map a caller has already built — from
//     `probe-report.json` once W0-H4 emits one, from a fixture until then.
//     There is no default status and no "assume resolved" path.
//   * `inMemoryRuntimeFlags` holds flags in process. The `runtime_flags` table,
//     the 5-second hot-reload poll and `forge kill` are W0-E5's, and this
//     implementation is replaced by that one without any predicate changing.

import type {
  ProbeStatus,
  ProbeStatusSource,
  RuntimeFlag,
  RuntimeFlagSource,
  ToolId,
} from './types.js';

/**
 * A probe-status source over an already-loaded map. A tool absent from the map
 * has no status and is therefore NOT probe-enabled (see `ProbeStatusSource`).
 */
export function staticProbeStatuses(statuses: ReadonlyMap<ToolId, ProbeStatus>): ProbeStatusSource {
  return {
    statusFor(toolId) {
      return statuses.get(toolId) ?? null;
    },
  };
}

/**
 * A source with no probe report at all. Every tool is unresolved, so nothing is
 * visible. This is the honest Wave 0 default before W0-H4 lands: a gateway that
 * has never probed knows that no binding works, and 02 §4.5's rule is that a
 * tool which is not `resolved | degraded_readonly` is excluded from
 * `tools/list`. It is exported so a caller must choose it explicitly rather
 * than getting an accidental permissive default.
 */
export function noProbeReport(): ProbeStatusSource {
  return {
    statusFor() {
      return null;
    },
  };
}

/** Is this flag in force at `now`? An `until` in the past is spent. */
export function isFlagActive(flag: RuntimeFlag, now: Date): boolean {
  const until = flag.until ?? null;
  if (until === null) return true;
  return until.getTime() > now.getTime();
}

/** An in-process flag source. Replaced by W0-E5's store-backed one. */
export function inMemoryRuntimeFlags(initial: readonly RuntimeFlag[] = []): RuntimeFlagSource & {
  set(flags: readonly RuntimeFlag[]): void;
} {
  let flags: readonly RuntimeFlag[] = [...initial];
  return {
    activeFlags() {
      return flags;
    },
    set(next) {
      flags = [...next];
    },
  };
}
