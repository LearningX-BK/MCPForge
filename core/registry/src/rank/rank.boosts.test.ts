// MCPForge — stage 5's boosts, each proved to move ranking on its own.
// W0-G2, 02 §5.4.2 stage 5.
//
// The isolation shape is W0-E2's predicate-removal proof turned around: for
// each boost, rank the same world twice — once with the boost at its default
// weight, once with that ONE weight zeroed — and assert that the ordering
// changes exactly where that boost applies and nowhere else. A boost that
// could be deleted without changing any ranking is not a boost, and a boost
// whose removal changes an unrelated pair is not isolated.

import { describe, expect, it } from 'vitest';
import {
  activeRoleBoost,
  entityMatchBoost,
  queryVerbs,
  statusPenalty,
  verbMatchBoost,
} from './boosts.js';
import { rankTools } from './pipeline.js';
import { DEFAULT_RANK_WEIGHTS, RESOLVED_STATUS } from './weights.js';
import { indexOf, nearMissIndex, positionOf, seeAll, toolInput } from './rank.fixtures.js';

describe('stage 5 — closed-list verb match', () => {
  it('reads the closed 19-item verb list, and multi-word verbs need every token', () => {
    expect(queryVerbs('cancel the voucher')).toEqual(new Set(['cancel']));
    expect(queryVerbs('what is the status')).toEqual(new Set());
    expect(queryVerbs('get the status of the job')).toEqual(new Set(['get', 'get_status']));
    // Not a closed-list verb — no boost, however verb-like the word is.
    expect(queryVerbs('post the journal')).toEqual(new Set());
  });

  it('moves ranking on its own: with the verb boost zeroed, the wrong sibling wins', () => {
    // Two vouchers tools whose lexical documents both answer "voucher"; the
    // ONLY thing separating them for this query is the verb.
    const index = indexOf(
      toolInput({
        id: 'jde.ap.voucher.search',
        // Deliberately the stronger LEXICAL match for "cancel a voucher": it
        // says "cancel" repeatedly. Only its `verb` field says `search`, and
        // that field is the sole input to the boost under test.
        title: 'Vouchers to cancel',
        purpose: 'Find vouchers to cancel — cancel, cancel, cancel.',
        entity: 'voucher',
        verb: 'search',
        write: false,
      }),
      toolInput({
        id: 'jde.ap.voucher.cancel',
        title: 'Voucher',
        purpose: 'Void one.',
        entity: 'voucher',
        verb: 'cancel',
        write: true,
      }),
    );
    const query = { text: 'cancel a voucher' };
    const visibility = seeAll(index);

    const withBoost = rankTools(index, query, { visibility });
    expect(withBoost[0]!.id).toBe('jde.ap.voucher.cancel');
    expect(withBoost[0]!.breakdown.verbMatch).toBe(DEFAULT_RANK_WEIGHTS.verbMatch);

    const withoutBoost = rankTools(index, query, { visibility, weights: { verbMatch: 0 } });
    expect(withoutBoost[0]!.id).toBe('jde.ap.voucher.search');
  });

  it('fires only for the matching tool', () => {
    const index = nearMissIndex();
    const entry = index.tools.find((t) => t.id === 'jde.ap.voucher.search')!;
    expect(verbMatchBoost(entry, 'search for vouchers', DEFAULT_RANK_WEIGHTS)).toBe(
      DEFAULT_RANK_WEIGHTS.verbMatch,
    );
    expect(verbMatchBoost(entry, 'get a voucher', DEFAULT_RANK_WEIGHTS)).toBe(0);
  });
});

describe('stage 5 — entity match', () => {
  it('moves ranking on its own', () => {
    const index = indexOf(
      toolInput({
        id: 'jde.ap.supplier.get',
        // Deliberately the stronger LEXICAL match for "get the voucher": its
        // prose is about vouchers. Only its `entity` field says `supplier`,
        // and that field is the sole input to the boost under test.
        title: 'Get the supplier behind a voucher',
        purpose: 'Voucher, voucher, voucher — get the voucher voucher party.',
        entity: 'supplier',
        verb: 'get',
        write: false,
      }),
      toolInput({
        id: 'jde.ap.voucher.get',
        title: 'Get',
        purpose: 'Read one.',
        entity: 'voucher',
        verb: 'get',
        write: false,
      }),
    );
    const query = { text: 'get the voucher' };
    const visibility = seeAll(index);

    const withBoost = rankTools(index, query, { visibility });
    expect(withBoost[0]!.id).toBe('jde.ap.voucher.get');
    expect(withBoost[0]!.breakdown.entityMatch).toBe(DEFAULT_RANK_WEIGHTS.entityMatch);
    // The verb boost fires for BOTH tools here, so it cannot be what decided it.
    expect(withBoost.map((r) => r.breakdown.verbMatch)).toEqual([
      DEFAULT_RANK_WEIGHTS.verbMatch,
      DEFAULT_RANK_WEIGHTS.verbMatch,
    ]);

    const withoutBoost = rankTools(index, query, { visibility, weights: { entityMatch: 0 } });
    expect(withoutBoost[0]!.id).toBe('jde.ap.supplier.get');
  });

  it('a multi-word entity needs every token, so "order" alone does not fire it', () => {
    const index = indexOf(
      toolInput({
        id: 'jde.pu.purchase_order.get',
        entity: 'purchase_order',
        verb: 'get',
        write: false,
      }),
    );
    const entry = index.tools[0]!;
    expect(entityMatchBoost(entry, 'get purchase order 4711', DEFAULT_RANK_WEIGHTS)).toBe(
      DEFAULT_RANK_WEIGHTS.entityMatch,
    );
    expect(entityMatchBoost(entry, 'get order 4711', DEFAULT_RANK_WEIGHTS)).toBe(0);
  });
});

describe('stage 5 — active-role membership', () => {
  it('moves ranking on its own, without changing what is returned', () => {
    const index = indexOf(
      toolInput({
        id: 'jde.ap.voucher.get',
        entity: 'voucher',
        verb: 'get',
        write: false,
        roles: ['p2p'],
      }),
      toolInput({
        id: 'jde.gl.voucher.get',
        module: 'gl',
        entity: 'voucher',
        verb: 'get',
        write: false,
        roles: ['r2r'],
      }),
    );
    const query = { text: 'get a voucher' };

    const neutral = rankTools(index, query, { visibility: seeAll(index) });
    const r2r = rankTools(index, query, { visibility: seeAll(index, ['r2r']) });

    expect(r2r[0]!.id).toBe('jde.gl.voucher.get');
    expect(r2r[0]!.breakdown.activeRole).toBe(DEFAULT_RANK_WEIGHTS.activeRole);
    expect(neutral[0]!.id).not.toBe('jde.gl.voucher.get');

    // A preference, never a permission: the non-role tool is still returned.
    expect(new Set(r2r.map((t) => t.id))).toEqual(new Set(neutral.map((t) => t.id)));

    const zeroed = rankTools(index, query, {
      visibility: seeAll(index, ['r2r']),
      weights: { activeRole: 0 },
    });
    expect(zeroed.map((t) => t.id)).toEqual(neutral.map((t) => t.id));
  });

  it('is exactly zero when no role is active', () => {
    const index = nearMissIndex();
    const entry = index.tools[0]!;
    expect(activeRoleBoost(entry, seeAll(index), DEFAULT_RANK_WEIGHTS)).toBe(0);
  });
});

describe('stage 5 — status penalty', () => {
  it('demotes an unresolved tool without removing it', () => {
    const index = indexOf(
      toolInput({
        id: 'jde.ap.voucher.get',
        entity: 'voucher',
        verb: 'get',
        write: false,
        status: 'unresolved',
      }),
      toolInput({ id: 'jde.ap.voucher.list', entity: 'voucher', verb: 'list', write: false }),
    );
    const ranked = rankTools(index, { text: 'voucher' }, { visibility: seeAll(index) });
    expect(positionOf(ranked, 'jde.ap.voucher.get')).toBeGreaterThan(-1);
    expect(ranked.find((r) => r.id === 'jde.ap.voucher.get')!.breakdown.statusPenalty).toBe(
      DEFAULT_RANK_WEIGHTS.statusPenalty,
    );
    expect(ranked.find((r) => r.id === 'jde.ap.voucher.list')!.breakdown.statusPenalty).toBe(0);
  });

  it('penalises anything that is not exactly `resolved`', () => {
    for (const status of ['unresolved', 'degraded_readonly', 'unavailable']) {
      const index = indexOf(toolInput({ status }));
      expect(statusPenalty(index.tools[0]!, DEFAULT_RANK_WEIGHTS)).toBe(
        DEFAULT_RANK_WEIGHTS.statusPenalty,
      );
    }
    const resolved = indexOf(toolInput({ status: RESOLVED_STATUS }));
    expect(statusPenalty(resolved.tools[0]!, DEFAULT_RANK_WEIGHTS)).toBe(0);
  });
});
