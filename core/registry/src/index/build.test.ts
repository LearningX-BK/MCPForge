import { describe, expect, it } from 'vitest';
import { buildCatalogueIndex, findEvalAliasLeaks } from './build.js';
import type { CatalogueIndexToolInput } from './types.js';

function tool(overrides: Partial<CatalogueIndexToolInput> = {}): CatalogueIndexToolInput {
  return {
    id: 'jde.ap.voucher.create',
    title: 'Create a voucher',
    purpose: 'Create an AP voucher against a supplier, optionally matched to a PO.',
    aliases: ['supplier invoice', 'enter a bill', 'AP invoice entry', 'book a payable'],
    disambiguation: 'Creates a NEW voucher.',
    entity: 'voucher',
    verb: 'create',
    app: 'jde',
    module: 'ap',
    appLabel: 'jde',
    moduleLabel: 'JD Edwards Financials — Accounts Payable',
    functionalArea: 'Accounts Payable',
    bindingType: 'function',
    archetype: 'transactional',
    sensitivity: 'financial',
    write: true,
    processTags: ['P2P'],
    packageTags: ['jde-fin'],
    roles: ['p2p'],
    status: 'unresolved',
    ...overrides,
  };
}

describe('buildCatalogueIndex', () => {
  it('carries every structured filter field named in 02 §5.4.1 item 1', () => {
    const index = buildCatalogueIndex([tool()], new Set());
    expect(index.tools).toHaveLength(1);
    const entry = index.tools[0]!;
    expect(entry.filters).toEqual({
      app: 'jde',
      module: 'ap',
      entity: 'voucher',
      verb: 'create',
      bindingType: 'function',
      archetype: 'transactional',
      sensitivity: 'financial',
      write: true,
      processTags: ['P2P'],
      packageTags: ['jde-fin'],
      roles: ['p2p'],
      status: 'unresolved',
    });
  });

  it('builds the lexical document from title + purpose + aliases + entity + module label + app label + functionalArea + id split on separators', () => {
    const index = buildCatalogueIndex([tool()], new Set());
    const doc = index.tools[0]!.lexicalDocument;
    for (const expected of [
      'Create a voucher',
      'Create an AP voucher against a supplier, optionally matched to a PO.',
      'supplier invoice',
      'enter a bill',
      'AP invoice entry',
      'book a payable',
      'voucher',
      'JD Edwards Financials — Accounts Payable',
      'jde',
      'Accounts Payable',
      'ap',
      'create',
    ]) {
      expect(doc).toContain(expected);
    }
    // "jde.ap.voucher.create" split on separators.
    expect(doc).toMatch(/\bjde\b/);
    expect(doc).toMatch(/\bap\b/);
    expect(doc).toMatch(/\bvoucher\b/);
    expect(doc).toMatch(/\bcreate\b/);
  });

  it('carries the disambiguation text verbatim', () => {
    const index = buildCatalogueIndex([tool({ disambiguation: 'X vs Y.' })], new Set());
    expect(index.tools[0]!.disambiguation).toBe('X vs Y.');
  });

  it('null disambiguation stays null, never coerced to empty string', () => {
    const index = buildCatalogueIndex([tool({ disambiguation: null })], new Set());
    expect(index.tools[0]!.disambiguation).toBeNull();
  });

  it('sorts entries by id regardless of input order', () => {
    const index = buildCatalogueIndex(
      [tool({ id: 'jde.ap.voucher.get' }), tool({ id: 'jde.ap.voucher.cancel' })],
      new Set(),
    );
    expect(index.tools.map((t) => t.id)).toEqual(['jde.ap.voucher.cancel', 'jde.ap.voucher.get']);
  });

  it('sorts array-valued filter fields for determinism regardless of manifest authoring order', () => {
    const index = buildCatalogueIndex(
      [tool({ processTags: ['R2R', 'P2P'], roles: ['r2r', 'p2p'], packageTags: ['z', 'a'] })],
      new Set(),
    );
    expect(index.tools[0]!.filters.processTags).toEqual(['P2P', 'R2R']);
    expect(index.tools[0]!.filters.roles).toEqual(['p2p', 'r2r']);
    expect(index.tools[0]!.filters.packageTags).toEqual(['a', 'z']);
  });

  it('is a pure function: two calls on the same input produce deep-equal output', () => {
    const input = [tool(), tool({ id: 'jde.ap.voucher.get', verb: 'get' })];
    const a = buildCatalogueIndex(input, new Set());
    const b = buildCatalogueIndex(input, new Set());
    expect(a).toEqual(b);
  });

  // --- The evals/** leak rule (W0-B3), exercised again here (W0-G1's own done criterion). ---

  describe('the eval-intent leak guard', () => {
    it('findEvalAliasLeaks reports nothing when no alias matches an eval intent', () => {
      const leaks = findEvalAliasLeaks([tool()], new Set(['cancel my subscription']));
      expect(leaks).toEqual([]);
    });

    it('findEvalAliasLeaks reports a verbatim match', () => {
      const leaks = findEvalAliasLeaks([tool()], new Set(['book a payable']));
      expect(leaks).toEqual([{ toolId: 'jde.ap.voucher.create', alias: 'book a payable' }]);
    });

    it('the match is case- and surrounding-whitespace-insensitive, same as policy.eval-alias-leak', () => {
      const leaks = findEvalAliasLeaks(
        [tool({ aliases: ['  Book A Payable  '] })],
        new Set(['book a payable']),
      );
      expect(leaks).toHaveLength(1);
    });

    it('buildCatalogueIndex REFUSES to build an index when a benchmark intent leaks into an alias — no partial artefact is ever emitted', () => {
      expect(() => buildCatalogueIndex([tool()], new Set(['book a payable']))).toThrow(
        /benchmark intent/i,
      );
      expect(() => buildCatalogueIndex([tool()], new Set(['book a payable']))).toThrow(
        /jde\.ap\.voucher\.create/,
      );
    });

    it('a non-matching eval intent set never blocks the build', () => {
      expect(() =>
        buildCatalogueIndex([tool()], new Set(['run the month-end close'])),
      ).not.toThrow();
    });
  });
});
