// MCPForge — W0-E7: one span per 02 §4.8 budget-table row.
import { describe, expect, it } from 'vitest';
import { BUDGET_STAGES, budgetStage, TOTAL_STAGE_BUDGET_MS } from './stages.js';

const TABLE_ROWS: ReadonlyArray<{ label: string; budgetMs: number }> = [
  { label: 'Transport + protocol', budgetMs: 3 },
  { label: 'Auth (cached JWT validation, JWKS cached)', budgetMs: 5 },
  { label: 'Identity + mapping resolution (cached)', budgetMs: 3 },
  { label: 'Scope resolution (in-memory set ops)', budgetMs: 1 },
  { label: 'Policy chain incl. compiled Ajv validation', budgetMs: 5 },
  { label: 'forge.find when called (BM25 + optional vector cosine)', budgetMs: 12 },
  { label: 'Confirm-token verify + nonce consume (1 DB round trip)', budgetMs: 8 },
  { label: 'Idempotency lookup/insert (1 DB round trip)', budgetMs: 8 },
  { label: 'Result shaping + redaction', budgetMs: 4 },
  { label: 'Audit write (outbox insert, same txn as idempotency)', budgetMs: 6 },
];

describe('BUDGET_STAGES matches 02 §4.8 row for row', () => {
  it('has exactly ten stages, in the documented order', () => {
    expect(BUDGET_STAGES).toHaveLength(10);
    BUDGET_STAGES.forEach((stage, i) => {
      const row = TABLE_ROWS[i];
      expect(row).toBeDefined();
      expect(stage.label).toBe(row?.label);
      expect(stage.budgetMs).toBe(row?.budgetMs);
    });
  });

  it('sums the ten row budgets to 55ms, leaving the documented ~95ms headroom of the 150ms total', () => {
    expect(TOTAL_STAGE_BUDGET_MS).toBe(55);
  });

  it('names every span identifiably to its row: gateway.stage.<id>', () => {
    for (const stage of BUDGET_STAGES) {
      expect(stage.spanName).toBe(`gateway.stage.${stage.id}`);
    }
  });

  it('budgetStage looks up a spec by id and throws for an unknown one', () => {
    expect(budgetStage('audit_write').label).toBe(
      'Audit write (outbox insert, same txn as idempotency)',
    );
    // @ts-expect-error — deliberately an invalid id, to prove the runtime guard.
    expect(() => budgetStage('not_a_stage')).toThrow();
  });
});
