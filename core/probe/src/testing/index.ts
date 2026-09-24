// MCPForge — probe test support. W0-H4.
//
// Two fixtures, both honest about what they are:
//
//  * `fixtureDatabaseGrantSource` — [P5] 02 §11.4.3's database-side EXECUTE
//    grants, from a literal map. This is the ONLY grant source that exists at
//    Wave 0. It reports `evidence: 'fixture'`, which travels into the report,
//    so nothing downstream can mistake a fixture reconciliation for a live one.
//  * `staticExecutor` — a check executor driven by a name->outcome table, for
//    exercising the status reducer over binding types that have no Wave 0
//    executor at all.
//
// `tests/mocks/**` (W0-H6, the recorded-fixture harness) had not landed when
// this package was written, so the `function` path is exercised against
// `@mcpforge/adapter-function/testing`'s in-process fake AIS server instead.

import type { BindingType } from '@mcpforge/shared/manifest';
import type {
  ProbeCheckContext,
  ProbeCheckExecutor,
  ProbeCheckResult,
  CheckOutcome,
} from '../plan/types.js';
import type { DatabaseGrantSource } from '../reconcile/binding-grants.js';

/** [P5] fixture-only. Never claims `live`. */
export function fixtureDatabaseGrantSource(
  grantsByToolId: ReadonlyMap<string, readonly string[]>,
): DatabaseGrantSource {
  return {
    evidence: 'fixture',
    executeGrantsFor(toolId) {
      return grantsByToolId.get(toolId) ?? null;
    },
  };
}

export interface StaticExecutorOptions {
  readonly bindingType: BindingType;
  /** check name -> outcome. A name absent from the table fails, never passes. */
  readonly outcomes: ReadonlyMap<string, CheckOutcome>;
}

export function staticExecutor(options: StaticExecutorOptions): ProbeCheckExecutor {
  return {
    bindingType: options.bindingType,
    run(ctx: ProbeCheckContext): Promise<ProbeCheckResult> {
      const outcome = options.outcomes.get(ctx.check.name) ?? 'fail';
      return Promise.resolve({
        name: ctx.check.name,
        result: outcome,
        detail: `fixture executor returned "${outcome}" for "${ctx.check.describe}"`,
      });
    },
  };
}
