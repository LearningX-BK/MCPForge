// MCPForge — the ten latency-budget stages, named identifiably. W0-E7.
// 02 §4.8's budget table, in order. Each row becomes exactly one span name
// below, so a trace's spans line up 1:1 with the table a human already reads.
// This file is the naming convention: `gateway.stage.<slug>`. Nothing here
// computes latency; ./tracer.ts's `withStageSpan` records duration by wrapping
// a stage's real work in a span of this name.

export type BudgetStageId =
  | 'transport_protocol'
  | 'auth'
  | 'identity_mapping'
  | 'scope_resolution'
  | 'policy_chain'
  | 'forge_find'
  | 'confirm_token_nonce'
  | 'idempotency'
  | 'result_shaping'
  | 'audit_write';

export interface BudgetStageSpec {
  readonly id: BudgetStageId;
  /** The exact 02 §4.8 table row label, for cross-reference in dashboards. */
  readonly label: string;
  /** p95 budget in milliseconds, from the same row. */
  readonly budgetMs: number;
  /** OTel span name: `gateway.stage.<id>`. */
  readonly spanName: string;
}

function spec(id: BudgetStageId, label: string, budgetMs: number): BudgetStageSpec {
  return { id, label, budgetMs, spanName: `gateway.stage.${id}` };
}

/**
 * The budget table, 02 §4.8, in its documented order. `stages.ts` in
 * `core/gateway/policy` is a DIFFERENT decomposition — the ten policy-chain
 * stages 6a..6h plus 6a′/6e′ — and `policy_chain` below is exactly one row
 * covering the whole of that chain, not a stage-for-stage mirror of it. Do not
 * conflate the two: this file measures wall time against the latency budget;
 * that file measures authorization order.
 */
export const BUDGET_STAGES: readonly BudgetStageSpec[] = Object.freeze([
  spec('transport_protocol', 'Transport + protocol', 3),
  spec('auth', 'Auth (cached JWT validation, JWKS cached)', 5),
  spec('identity_mapping', 'Identity + mapping resolution (cached)', 3),
  spec('scope_resolution', 'Scope resolution (in-memory set ops)', 1),
  spec('policy_chain', 'Policy chain incl. compiled Ajv validation', 5),
  spec('forge_find', 'forge.find when called (BM25 + optional vector cosine)', 12),
  spec('confirm_token_nonce', 'Confirm-token verify + nonce consume (1 DB round trip)', 8),
  spec('idempotency', 'Idempotency lookup/insert (1 DB round trip)', 8),
  spec('result_shaping', 'Result shaping + redaction', 4),
  spec('audit_write', 'Audit write (outbox insert, same txn as idempotency)', 6),
]);

const BY_ID: ReadonlyMap<BudgetStageId, BudgetStageSpec> = new Map(
  BUDGET_STAGES.map((s) => [s.id, s]),
);

export function budgetStage(id: BudgetStageId): BudgetStageSpec {
  const found = BY_ID.get(id);
  if (found === undefined) {
    // Unreachable for a well-typed id; thrown rather than silently defaulted so
    // a future stage added to the type but not the table fails loudly.
    throw new Error(`No 02 §4.8 budget-table row for stage id "${id}"`);
  }
  return found;
}

/** Sum of every row's budget, excluding headroom — the table's own arithmetic, not the 150ms total. */
export const TOTAL_STAGE_BUDGET_MS: number = BUDGET_STAGES.reduce((sum, s) => sum + s.budgetMs, 0);
