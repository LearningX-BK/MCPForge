// MCPForge — W0-J13: the three agent representations, measured with the
// REAL pinned tokenizer (`@mcpforge/shared`'s `countTokens`) — never an
// estimate, per the task's `done:` line.
import { countTokens } from '@mcpforge/shared';
import { describe, expect, it } from 'vitest';

import { buildCard, buildDescribePayload, buildResidentDefinition } from './agent-representations';
import { fixtureCatalogSource } from './fixtures';

const voucherCreate = fixtureCatalogSource().tools.find((t) => t.manifest.id === 'jde.ap.voucher.create')!.manifest;

describe('buildCard', () => {
  it('measures the card with the real tokenizer, not an estimate', () => {
    const rep = buildCard(voucherCreate);
    expect(rep.tokens).toBe(countTokens(JSON.stringify(rep.json)));
  });

  it('carries the ≤60 card budget', () => {
    const rep = buildCard(voucherCreate);
    expect(rep.budget).toBe(60);
    expect(rep.withinBudget).toBe(rep.tokens <= 60);
  });

  it('the card shape matches the real generator field set (palette/card-fields.ts)', () => {
    const rep = buildCard(voucherCreate);
    expect(Object.keys(rep.json).sort()).toEqual(
      ['binding', 'entity', 'id', 'purpose', 'roles', 'sensitivity', 'status', 'verb', 'write'].sort(),
    );
  });
});

describe('buildResidentDefinition', () => {
  it('carries the 200-typical / 400-hard resident budget', () => {
    const rep = buildResidentDefinition(voucherCreate);
    expect(rep.budget).toBe(200);
  });
});

describe('buildDescribePayload', () => {
  it('carries the ≤600 describe budget and includes write safety for a write tool', () => {
    const rep = buildDescribePayload(voucherCreate);
    expect(rep.budget).toBe(600);
    expect(rep.json['writeSafety']).toBeDefined();
  });

  it('omits writeSafety for a read tool', () => {
    const search = fixtureCatalogSource().tools.find((t) => t.manifest.id === 'jde.ap.voucher.search')!.manifest;
    const rep = buildDescribePayload(search);
    expect(rep.json['writeSafety']).toBeUndefined();
  });
});
