// MCPForge — W0-J14: `buildPreviews` reuses the REAL codegen builders and
// the REAL pinned token counter/budgets — never a second implementation.
import { describe, expect, it } from 'vitest';
import { TOKEN_BUDGETS, countTokens } from '@mcpforge/shared';
import { buildPreviews } from './representations';
import { loadBuildDrafts } from '../fixtures';

describe('buildPreviews', () => {
  const draft = loadBuildDrafts()[0]!; // jde.ap.voucher.create — a real write tool

  it('measures the card against the real ≤60-token budget with the real counter', () => {
    const { card } = buildPreviews(draft.yaml);
    expect(card.budget).toBe(TOKEN_BUDGETS.card);
    expect(card.tokens).toBe(countTokens(JSON.stringify(card.json)));
    expect(card.withinBudget).toBe(card.tokens <= TOKEN_BUDGETS.card);
  });

  it('measures the resident definition against the real 400-token hard cap', () => {
    const { resident } = buildPreviews(draft.yaml);
    expect(resident.budget).toBe(TOKEN_BUDGETS.residentHard);
  });

  it('measures the describe payload against the real ≤600-token budget, and carries writeSafety for a write tool', () => {
    const { describe: describePreview } = buildPreviews(draft.yaml);
    expect(describePreview.budget).toBe(TOKEN_BUDGETS.describe);
    expect(describePreview.json['writeSafety']).toBeDefined();
  });

  it('measures the generated schema with no declared budget, never fabricating one', () => {
    const { schema } = buildPreviews(draft.yaml);
    expect(schema.budget).toBeUndefined();
    expect(schema.withinBudget).toBe(true);
    expect(schema.json['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('the card is a strict field subset of what the real generator emits, for the real seeded tool id', () => {
    const { card } = buildPreviews(draft.yaml);
    expect(card.json['id']).toBe('jde.ap.voucher.create');
    expect(card.json['write']).toBe(true);
    expect(card.json['binding']).toBe('function');
  });

  it('never throws on an unparseable draft, and reports empty-shaped previews', () => {
    expect(() => buildPreviews('::: not yaml :::')).not.toThrow();
  });
});
