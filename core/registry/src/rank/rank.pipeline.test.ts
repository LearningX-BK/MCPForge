// MCPForge — the six-stage pipeline itself, and the Wave 0 absence of the
// semantic channel. W0-G2, 02 §5.4.2, §5.4.3.

import { describe, expect, it, vi } from 'vitest';
import { PASS_THROUGH_FLOOR, rankTools } from './pipeline.js';
import { WAVE0_SEMANTIC_CHANNEL, isSemanticChannelEnabled } from './semantic.js';
import { fuse, rankOrder } from './fusion.js';
import { scoreBm25 } from './bm25.js';
import { RRF_K } from './weights.js';
import { indexOf, nearMissIndex, seeAll, seeOnly, toolInput } from './rank.fixtures.js';
import type { FloorPolicy, SemanticChannel } from './types.js';

describe('stage 3 — the semantic channel is pluggable and UNIMPLEMENTED at Wave 0', () => {
  it('the Wave 0 binding is explicitly null — absent, not a no-op', () => {
    expect(WAVE0_SEMANTIC_CHANNEL).toBeNull();
    expect(isSemanticChannelEnabled(WAVE0_SEMANTIC_CHANNEL)).toBe(false);
    expect(isSemanticChannelEnabled(undefined)).toBe(false);
  });

  it('ranks correctly with the channel entirely absent', () => {
    const index = nearMissIndex();
    const ranked = rankTools(
      index,
      { text: 'search for vouchers by supplier' },
      {
        visibility: seeAll(index),
      },
    );
    expect(ranked[0]!.id).toBe('jde.ap.voucher.search');
    // One channel fused: a rank-1 hit normalises to exactly 1.0.
    expect(ranked[0]!.breakdown.fusion).toBeCloseTo(1, 12);
  });

  it('an explicit null is indistinguishable from omitting it', () => {
    const index = nearMissIndex();
    const query = { text: 'get a voucher' };
    const omitted = rankTools(index, query, { visibility: seeAll(index) });
    const explicit = rankTools(index, query, { visibility: seeAll(index), semanticChannel: null });
    expect(explicit).toEqual(omitted);
  });

  it('the seam accepts an implementation and fuses it — the Wave 1 substitution, exercised', () => {
    // Not a Wave 0 implementation: a test double, present only to prove the
    // interface is real and that enabling a second channel changes fusion
    // without touching any other stage.
    const index = nearMissIndex();
    const reversing: SemanticChannel = {
      id: 'test-double',
      score: (_q, entries) => new Map(entries.map((e, i) => [e.id, entries.length - i])),
    };
    const spy = vi.spyOn(reversing, 'score');
    const ranked = rankTools(
      index,
      { text: 'voucher' },
      {
        visibility: seeAll(index),
        semanticChannel: reversing,
      },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    // The double only ever sees stage 1's survivors, never the whole index.
    expect(spy.mock.calls[0]![1].map((e) => e.id)).toEqual(index.tools.map((t) => t.id));
    expect(ranked.length).toBe(index.tools.length);
  });

  it('the semantic channel is never consulted for a tool stage 1 removed', () => {
    const index = nearMissIndex();
    const seen: string[] = [];
    const channel: SemanticChannel = {
      id: 'observer',
      score: (_q, entries) => {
        seen.push(...entries.map((e) => e.id));
        return new Map();
      },
    };
    rankTools(
      index,
      { text: 'voucher' },
      {
        visibility: seeOnly(['jde.ap.voucher.get']),
        semanticChannel: channel,
      },
    );
    expect(seen).toEqual(['jde.ap.voucher.get']);
  });
});

describe('stage 4 — reciprocal rank fusion', () => {
  it('normalises a rank-1 hit to 1.0 and decays monotonically', () => {
    const fused = fuse(
      [
        new Map([
          ['a', 10],
          ['b', 5],
          ['c', 1],
        ]),
      ],
      RRF_K,
    );
    expect(fused.get('a')).toBeCloseTo(1, 12);
    expect(fused.get('b')!).toBeLessThan(fused.get('a')!);
    expect(fused.get('c')!).toBeLessThan(fused.get('b')!);
  });

  it('a tool ranked well by both channels wins over one ranked well by only one', () => {
    const lexical = new Map([
      ['both', 9],
      ['lexical_only', 10],
    ]);
    const semantic = new Map([
      ['both', 9],
      ['semantic_only', 10],
    ]);
    const fused = fuse([lexical, semantic], RRF_K);
    expect(fused.get('both')!).toBeGreaterThan(fused.get('lexical_only')!);
    expect(fused.get('both')!).toBeGreaterThan(fused.get('semantic_only')!);
  });

  it('breaks equal channel scores by id, so the ordering is deterministic', () => {
    expect(
      rankOrder(
        new Map([
          ['b', 1],
          ['a', 1],
        ]),
      ),
    ).toEqual(['a', 'b']);
  });

  it('with no channels enabled, fusion contributes nothing at all', () => {
    expect(fuse([], RRF_K).size).toBe(0);
  });
});

describe('stage 2 — the lexical channel', () => {
  it('omits documents that share no term with the query rather than scoring them zero', () => {
    const index = indexOf(
      toolInput({ id: 'jde.ap.voucher.get', entity: 'voucher', verb: 'get', write: false }),
    );
    expect(scoreBm25('payroll adjustment', index.tools).size).toBe(0);
  });

  it('retrieves nothing for an empty query', () => {
    const index = nearMissIndex();
    expect(scoreBm25('', index.tools).size).toBe(0);
  });
});

describe('the pipeline', () => {
  it('runs the stages in order and survives a purely structured query with no text', () => {
    const index = nearMissIndex();
    const ranked = rankTools(
      index,
      { text: '', filters: { module: 'gl' } },
      {
        visibility: seeAll(index),
      },
    );
    expect(ranked.map((r) => r.id)).toEqual(['jde.gl.journal.get']);
    expect(ranked[0]!.breakdown.fusion).toBe(0);
  });

  it('is deterministic — the same inputs produce the same output, twice', () => {
    const index = nearMissIndex();
    const run = () =>
      rankTools(index, { text: 'get a voucher' }, { visibility: seeAll(index, ['p2p']) });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('reports a breakdown whose components sum to the score', () => {
    const index = nearMissIndex();
    const ranked = rankTools(
      index,
      { text: 'get a voucher' },
      {
        visibility: seeAll(index, ['p2p']),
        consumption: new Map([['jde.ap.voucher.get', 40]]),
      },
    );
    for (const result of ranked) {
      const b = result.breakdown;
      const sum =
        b.fusion + b.verbMatch + b.entityMatch + b.activeRole + b.consumption + b.statusPenalty;
      expect(result.score).toBeCloseTo(sum, 12);
    }
  });

  it('truncates to `limit` only after ranking everything', () => {
    const index = nearMissIndex();
    const all = rankTools(index, { text: 'get' }, { visibility: seeAll(index) });
    const two = rankTools(index, { text: 'get', limit: 2 }, { visibility: seeAll(index) });
    expect(two.map((r) => r.id)).toEqual(all.slice(0, 2).map((r) => r.id));
  });
});

describe('stage 6 — the floor is a pluggable stage owned by W0-G3', () => {
  it('the Wave 0 default is pass-through, not a floor of zero', () => {
    expect(PASS_THROUGH_FLOOR.id).toBe('pass-through');
    const index = nearMissIndex();
    const ranked = rankTools(index, { text: 'voucher' }, { visibility: seeAll(index) });
    expect(PASS_THROUGH_FLOOR.apply(ranked, { text: 'voucher' })).toBe(ranked);
  });

  it('a supplied policy is applied last, over the fully ranked and sorted list', () => {
    const index = nearMissIndex();
    let sawOrdered: readonly string[] = [];
    const floor: FloorPolicy = {
      id: 'test-floor',
      apply: (ranked) => {
        sawOrdered = ranked.map((r) => r.id);
        return ranked.filter((r) => r.breakdown.verbMatch > 0);
      },
    };
    const ranked = rankTools(
      index,
      { text: 'get a voucher' },
      { visibility: seeAll(index), floor },
    );
    expect(sawOrdered.length).toBe(index.tools.length);
    expect(ranked.every((r) => r.breakdown.verbMatch > 0)).toBe(true);
  });
});
