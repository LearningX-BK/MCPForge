// MCPForge — [P5] gateway `bindingGrants` × database-side `EXECUTE` grants.
// 02 §11.4.3, extending 02 §4.5's `plsql` row by one line. W0-H4.
//
// > "A gateway `bindingGrant` naming a wrapper package for which the database
// >  holds no `EXECUTE` grant — or a database `EXECUTE` grant with no
// >  corresponding gateway grant — is a probe finding, reported per tool with
// >  its owning team."
//
// SEAM-ONLY AT WAVE 0, stated plainly and not disguised: there is no `plsql`
// manifest in this repository (Wave 0's bindings are all `function`) and no
// live Oracle database in this environment. The comparison below is exercised
// against a FIXTURE grant source and is UNTESTED LIVE. Wave 2 supplies a
// `DatabaseGrantSource` that actually queries `ALL_TAB_PRIVS` and nothing else
// changes — same discipline as W0-C5 (Postgres parity) and W0-D3 (dual identity
// providers). Fabricating a live check here would put a green tick against a
// control nobody has run.

import type { BindingGrantReconciliation, GrantEvidence } from '../report/types.js';

/**
 * A compiled gateway binding grant, as `generated/roles/<id>.scope.json` and
 * `generated/consumers/<id>.authorization.json` carry it (W0-B8). Only the two
 * fields this reconciliation reads are modelled — `bindingType` to select the
 * `plsql` grants and `names` for the wrapper packages (02 §11.4.3: "for `plsql`,
 * the elevated grant names the wrapper package").
 */
export interface CompiledBindingGrant {
  readonly bindingType: string;
  readonly names: readonly string[];
}

/**
 * Where database-side `EXECUTE` grants come from. Wave 2's implementation runs
 * through the Oracle Adapter Worker; Wave 0's runs off a fixture. Returning
 * `null` means "this source could not report" — which produces
 * `evidence: 'unavailable'` and an unreconciled block, never an assumed pass.
 */
export interface DatabaseGrantSource {
  readonly evidence: Exclude<GrantEvidence, 'unavailable'>;
  executeGrantsFor(toolId: string): readonly string[] | null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Compare the two statements of the same fact. Pure — no I/O, no ordering
 * assumptions, and symmetric: a name on either side alone is a finding.
 */
export function reconcileBindingGrants(
  toolId: string,
  gatewayGrants: readonly CompiledBindingGrant[],
  source: DatabaseGrantSource | null,
): BindingGrantReconciliation {
  const gateway = sortedUnique(
    gatewayGrants.filter((g) => g.bindingType === 'plsql').flatMap((g) => [...g.names]),
  );

  const observed = source?.executeGrantsFor(toolId) ?? null;
  if (source === null || observed === null) {
    return {
      evidence: 'unavailable',
      gatewayGrants: gateway,
      databaseGrants: [],
      gatewayOnly: gateway,
      databaseOnly: [],
      // Unavailable is NOT reconciled. A missing observation is a finding, not
      // a pass — the same fail-closed reading `ProbeStatusSource`'s `null` gets.
      reconciled: false,
    };
  }

  const database = sortedUnique(observed);
  const dbSet = new Set(database);
  const gwSet = new Set(gateway);
  const gatewayOnly = gateway.filter((n) => !dbSet.has(n));
  const databaseOnly = database.filter((n) => !gwSet.has(n));

  return {
    evidence: source.evidence,
    gatewayGrants: gateway,
    databaseGrants: database,
    gatewayOnly,
    databaseOnly,
    reconciled: gatewayOnly.length === 0 && databaseOnly.length === 0,
  };
}

/** The one-line detail a failing `binding_grant_reconciliation` check carries. */
export function reconciliationDetail(r: BindingGrantReconciliation): string {
  if (r.evidence === 'unavailable') {
    return 'no database-side EXECUTE grant observation was available for this run (Wave 0: no live database; the live source lands at Wave 2)';
  }
  if (r.reconciled) {
    return `gateway and database grants agree on ${r.gatewayGrants.length} wrapper package(s) (evidence: ${r.evidence})`;
  }
  const parts: string[] = [];
  if (r.gatewayOnly.length > 0) {
    parts.push(`gateway grants the database does not: ${r.gatewayOnly.join(', ')}`);
  }
  if (r.databaseOnly.length > 0) {
    parts.push(`database EXECUTE grants the gateway does not: ${r.databaseOnly.join(', ')}`);
  }
  return `${parts.join('; ')} (evidence: ${r.evidence})`;
}
