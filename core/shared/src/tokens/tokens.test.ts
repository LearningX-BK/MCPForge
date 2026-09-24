import { describe, expect, it } from 'vitest';
import {
  TOKENIZER_ENCODING,
  TOKEN_BUDGETS,
  checkBudget,
  countJsonTokens,
  countTokens,
} from './index.js';

/**
 * GOLDEN FILE — 02 §5.7's "pinned tokenizer, version-locked".
 *
 * These three numbers are measured facts about `cl100k_base`, not targets. They
 * are hardcoded so a tokenizer change or a js-tiktoken bump fails HERE, loudly,
 * with a named diff — rather than silently shifting every card, resident,
 * describe and role-budget measurement in the product (metric drift).
 *
 * If one of these fails: do NOT update the number to make it pass. Find out
 * what changed, decide whether the new tokenizer is the one MCPForge measures
 * with, and re-baseline every recorded budget figure in the same change.
 */
const GOLDEN: readonly (readonly [label: string, text: string, tokens: number])[] = [
  // The `purpose` string of the 02 §2.2 worked example.
  ['purpose (02 §2.2)', 'Create an AP voucher against a supplier, optionally matched to a PO.', 14],
  // The business-consequence sentence of the plan template (CLAUDE.md §5).
  ['plan consequence (CLAUDE.md §5)', 'This creates an OPEN PAYABLE in JD Edwards.', 10],
  // The serialised discovery card of 02 §5.3(a).
  [
    'discovery card (02 §5.3a)',
    '{"id":"jde.ap.voucher.create","purpose":"Create an AP voucher against a supplier, optionally matched to a PO.","verb":"create","entity":"voucher","write":true,"binding":"function","sensitivity":"financial","roles":["p2p"],"status":"resolved"}',
    57,
  ],
];

describe('countTokens — pinned tokenizer', () => {
  it('is version-locked to cl100k_base', () => {
    expect(TOKENIZER_ENCODING).toBe('cl100k_base');
  });

  it.each(GOLDEN)('pins %s to its exact count', (_label, text, tokens) => {
    expect(countTokens(text)).toBe(tokens);
  });

  it('counts the empty string as zero', () => {
    expect(countTokens('')).toBe(0);
  });

  it('is deterministic across calls', () => {
    const text = GOLDEN[0]![1];
    expect(countTokens(text)).toBe(countTokens(text));
  });

  it('counts JSON as it would be serialised', () => {
    expect(countJsonTokens({ verb: 'create' })).toBe(countTokens('{"verb":"create"}'));
  });
});

describe('token budgets — 02 §5.3', () => {
  it('carries the four budgets from the architecture', () => {
    expect(TOKEN_BUDGETS).toEqual({
      card: 60,
      resident: 200,
      residentHard: 400,
      describe: 600,
      roleCoreSet: 1300,
    });
  });

  it('holds the worked card inside the ≤60 card budget', () => {
    const result = checkBudget('card', GOLDEN[2]![1]);
    expect(result.counted).toBe(57);
    expect(result.limit).toBe(60);
    expect(result.withinBudget).toBe(true);
  });

  it('reports a breach rather than throwing', () => {
    const result = checkBudget('card', 'word '.repeat(200));
    expect(result.withinBudget).toBe(false);
    expect(result.counted).toBeGreaterThan(result.limit);
  });
});
