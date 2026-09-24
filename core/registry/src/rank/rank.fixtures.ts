// MCPForge — synthetic catalogue-index entries and mock sessions for the
// ranking tests. W0-G2.
//
// Follows the fixture-module shape `core/gateway/scope/scope.fixtures.ts`
// (W0-E2) established: one small, hand-written world that every test in the
// family shares, plus builders that vary one axis at a time. Entries are
// built through `buildCatalogueIndex` rather than hand-written literals, so
// the lexical documents the ranker scores are the ones W0-G1 actually
// produces and a change to the document recipe breaks these tests loudly
// instead of silently diverging.

import { buildCatalogueIndex } from '../index/build.js';
import type { CatalogueIndex, CatalogueIndexToolInput } from '../index/types.js';
import type { SessionVisibility } from './types.js';

export function toolInput(
  overrides: Partial<CatalogueIndexToolInput> = {},
): CatalogueIndexToolInput {
  return {
    id: 'jde.ap.voucher.create',
    title: 'Create a voucher',
    purpose: 'Create an AP voucher against a supplier.',
    aliases: [],
    disambiguation: null,
    entity: 'voucher',
    verb: 'create',
    app: 'jde',
    module: 'ap',
    appLabel: 'jde',
    moduleLabel: 'JD Edwards Accounts Payable',
    functionalArea: 'Accounts Payable',
    bindingType: 'function',
    archetype: 'transactional',
    sensitivity: 'financial',
    write: true,
    processTags: ['P2P'],
    packageTags: ['jde-fin'],
    roles: ['p2p'],
    status: 'resolved',
    ...overrides,
  };
}

export function indexOf(...tools: readonly CatalogueIndexToolInput[]): CatalogueIndex {
  return buildCatalogueIndex(tools, new Set());
}

/** Every tool visible, no active role. The baseline against which a narrowing is measured. */
export function seeAll(
  index: CatalogueIndex,
  activeRoleIds: readonly string[] = [],
): SessionVisibility {
  return { visibleToolIds: new Set(index.tools.map((t) => t.id)), activeRoleIds };
}

/** A session that can reach exactly these tool ids — the shape `resolveScope(...).visible` hands over. */
export function seeOnly(
  ids: readonly string[],
  activeRoleIds: readonly string[] = [],
): SessionVisibility {
  return { visibleToolIds: new Set(ids), activeRoleIds };
}

/**
 * The near-miss world 02 §5.5 names: `voucher.get` vs `voucher.search`, plus a
 * different entity in the same module and a tool in a different module
 * entirely. Small enough to reason about by hand, wide enough that verb,
 * entity and role each discriminate something different.
 */
export function nearMissIndex(): CatalogueIndex {
  return indexOf(
    toolInput({
      id: 'jde.ap.voucher.get',
      title: 'Get a voucher',
      purpose: 'Return one voucher by document number.',
      entity: 'voucher',
      verb: 'get',
      write: false,
      roles: ['p2p'],
    }),
    toolInput({
      id: 'jde.ap.voucher.search',
      title: 'Search vouchers',
      purpose: 'Find vouchers by supplier, date or amount.',
      entity: 'voucher',
      verb: 'search',
      write: false,
      roles: ['p2p'],
    }),
    toolInput({
      id: 'jde.ap.supplier.get',
      title: 'Get a supplier',
      purpose: 'Return one supplier master record.',
      entity: 'supplier',
      verb: 'get',
      write: false,
      roles: ['p2p'],
    }),
    toolInput({
      id: 'jde.gl.journal.get',
      title: 'Get a journal entry',
      purpose: 'Return one general ledger journal entry.',
      module: 'gl',
      moduleLabel: 'JD Edwards General Ledger',
      functionalArea: 'General Ledger',
      entity: 'journal',
      verb: 'get',
      write: false,
      processTags: ['R2R'],
      roles: ['r2r'],
    }),
  );
}

/** The rank position of a tool id, or −1. */
export function positionOf(ranked: readonly { readonly id: string }[], id: string): number {
  return ranked.findIndex((r) => r.id === id);
}
