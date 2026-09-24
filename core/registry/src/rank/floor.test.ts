// MCPForge — stage 6: the floor, the `no_tool` verdict and the `choose`
// block. 02 §5.4.4, §5.5; 03 §9.2 items 3 and 5. W0-G3.

import { describe, expect, it } from 'vitest';
import {
  DO_NOT_APPROXIMATE,
  NO_TOOL_NEXT,
  chooseBlock,
  createScoreFloorPolicy,
  entityPrefix,
  evaluateFloor,
  isAboveFloor,
  noToolReason,
  sharesEntityPrefix,
  type FloorConfig,
} from './floor.js';
import { DEFAULT_FLOOR_CONFIG } from './floor.config.js';
import { rankTools } from './pipeline.js';
import { indexOf, seeAll, toolInput } from './rank.fixtures.js';
import type { CatalogueIndexEntry } from '../index/types.js';
import type { RankedResult } from './types.js';

const CONFIG: FloorConfig = { floor: 1.0, margin: 0.05 };

/** A `RankedResult` at an exact score — the floor and margin rules are arithmetic over `score`, so the boosts that produced it are irrelevant here. */
function at(id: string, score: number, disambiguation: string | null = null): RankedResult {
  const [app = '', module = '', entity = '', verb = ''] = id.split('.');
  const entry: CatalogueIndexEntry = {
    id,
    filters: {
      app,
      module,
      entity,
      verb,
      bindingType: 'function',
      archetype: 'transactional',
      sensitivity: 'financial',
      write: false,
      processTags: [],
      packageTags: [],
      roles: [],
      status: 'resolved',
    },
    lexicalDocument: id,
    disambiguation,
  };
  return {
    id,
    score,
    breakdown: {
      fusion: score,
      verbMatch: 0,
      entityMatch: 0,
      activeRole: 0,
      consumption: 0,
      statusPenalty: 0,
    },
    entry,
  };
}

describe('the floor predicate', () => {
  it('admits a score exactly at the floor and rejects the one below it', () => {
    expect(isAboveFloor(at('jde.ap.voucher.get', 1.0), CONFIG)).toBe(true);
    expect(isAboveFloor(at('jde.ap.voucher.get', 0.999), CONFIG)).toBe(false);
  });

  it('is the same comparison the policy makes — the policy truncates, it never re-ranks', () => {
    const ranked = [at('a.b.c.get', 1.4), at('a.b.d.get', 1.1), at('a.b.e.get', 0.9)];
    const kept = createScoreFloorPolicy(CONFIG).apply(ranked, { text: 'x' });
    expect(kept.map((r) => r.id)).toEqual(['a.b.c.get', 'a.b.d.get']);
  });

  it('the default policy id names the floor it was built with, so a ranking can be attributed to a configuration', () => {
    expect(createScoreFloorPolicy().id).toBe(`score-floor@${DEFAULT_FLOOR_CONFIG.floor}`);
  });
});

describe('no_tool (02 §5.4.4)', () => {
  const ranked = [
    at('jde.ap.voucher.create', 0.62),
    at('jde.gl.journal.create', 0.44),
    at('jde.ap.supplier.get', 0.21),
    at('jde.scm.purchase_order.get', 0.1),
  ];
  const verdict = evaluateFloor(ranked, { text: 'adjust an employee payroll deduction' }, CONFIG);

  it('returns exactly the four keys 02 §5.4.4 specifies', () => {
    expect(verdict.result).toBe('no_tool');
    expect(Object.keys(verdict).sort()).toEqual(['nearest', 'next', 'reason', 'result']);
  });

  it('names the nearest capabilities with their scores, capped and rounded', () => {
    if (verdict.result !== 'no_tool') throw new Error('expected no_tool');
    expect(verdict.nearest).toEqual([
      { id: 'jde.ap.voucher.create', score: 0.62 },
      { id: 'jde.gl.journal.create', score: 0.44 },
      { id: 'jde.ap.supplier.get', score: 0.21 },
    ]);
  });

  it('reasons in terms of the query and the areas the nearest capabilities sit in', () => {
    if (verdict.result !== 'no_tool') throw new Error('expected no_tool');
    expect(verdict.reason).toBe(
      'No tool in this catalogue covers "adjust an employee payroll deduction". The closest capabilities are in jde.ap and jde.gl, and none of them covers it.',
    );
  });

  // THE LOAD-BEARING ASSERTION OF THIS TASK. 02 §5.4.4: "Telling an agent
  // explicitly *not* to approximate is the difference between a clean miss
  // and a wrong write." Asserted on the WORDING, not on the presence of a
  // field — a `next` that said "try again" would satisfy W0-F5's non-empty
  // rule and violate this one.
  it('instructs the agent, in words, not to approximate with another tool', () => {
    if (verdict.result !== 'no_tool') throw new Error('expected no_tool');
    expect(verdict.next).toBe(
      "If this capability should exist, raise it through the MCPForge portal's Business Intake. Do not attempt to approximate it with another tool.",
    );
    expect(verdict.next).toContain('Do not attempt to approximate it with another tool.');
    expect(verdict.next.endsWith(DO_NOT_APPROXIMATE)).toBe(true);
    expect(verdict.next).not.toMatch(/try again/i);
  });

  it('the prohibition is a constant, identical on every no_tool, whatever the query', () => {
    for (const text of ['', 'pay the payroll run', 'x'.repeat(200)]) {
      const v = evaluateFloor(ranked, { text }, CONFIG);
      if (v.result !== 'no_tool') throw new Error('expected no_tool');
      expect(v.next).toBe(NO_TOOL_NEXT);
    }
  });

  it('degrades honestly when there is nothing near at all', () => {
    const v = evaluateFloor([], { text: 'run the payroll' }, CONFIG);
    if (v.result !== 'no_tool') throw new Error('expected no_tool');
    expect(v.nearest).toEqual([]);
    expect(v.reason).toBe(
      'No tool in this catalogue covers "run the payroll". The catalogue holds no comparable capability.',
    );
    expect(v.next).toBe(NO_TOOL_NEXT);
  });

  it('does not quote a query it was not given', () => {
    expect(noToolReason('   ', [])).toBe(
      'No tool in this catalogue covers this request. The catalogue holds no comparable capability.',
    );
  });

  it('fires on the LIMIT-independent question of whether a tool exists', () => {
    const v = evaluateFloor(ranked, { text: 'payroll', limit: 1 }, CONFIG);
    expect(v.result).toBe('no_tool');
  });
});

describe('the entity prefix (CLAUDE.md §5 — {app}.{module}.{entity}.{verb})', () => {
  it('is the first three segments of a four-segment id', () => {
    expect(entityPrefix('jde.ap.voucher.get')).toBe('jde.ap.voucher');
  });

  it('refuses a malformed id rather than treating it as a universal sibling', () => {
    expect(entityPrefix('jde.ap.voucher')).toBeNull();
    expect(entityPrefix('jde.ap.voucher.get.extra')).toBeNull();
    expect(entityPrefix('jde..voucher.get')).toBeNull();
    expect(sharesEntityPrefix('jde.ap.voucher', 'jde.ap.voucher')).toBe(false);
  });

  it('separates a sibling pair from a same-verb pair in another entity', () => {
    expect(sharesEntityPrefix('jde.ap.voucher.get', 'jde.ap.voucher.search')).toBe(true);
    expect(sharesEntityPrefix('jde.ap.voucher.get', 'jde.ap.supplier.get')).toBe(false);
    expect(sharesEntityPrefix('jde.ap.voucher.get', 'jde.gl.voucher.get')).toBe(false);
  });
});

describe('the choose block (02 §5.5 item 2)', () => {
  const GET_D =
    'voucher.get returns one voucher by document number. voucher.search finds vouchers by supplier, date or amount when you do not know the number.';
  const SEARCH_D =
    'voucher.search finds vouchers by supplier, date or amount. voucher.get returns one when you have the number.';

  it('fires when the top two are within the margin AND share an entity prefix', () => {
    const v = evaluateFloor(
      [
        at('jde.ap.voucher.get', 1.3, GET_D),
        at('jde.ap.voucher.search', 1.27, SEARCH_D),
        at('jde.ap.supplier.get', 1.05),
      ],
      { text: 'find the voucher' },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.tools.map((t) => t.id)).toEqual([
      'jde.ap.voucher.get',
      'jde.ap.voucher.search',
      'jde.ap.supplier.get',
    ]);
    expect(v.choose).toBe(`${GET_D} ${SEARCH_D}`);
  });

  // THE NEGATIVE CASE. 02 §5.5 is about siblings — `.get` / `.search` /
  // `.create` on the SAME entity. Two unrelated tools that happen to score
  // closely are a ranking near-tie, and answering it with a disambiguation
  // line would be answering a question nobody asked.
  it('does NOT fire when the top two are within the margin but are different entities', () => {
    const v = evaluateFloor(
      [
        at('jde.ap.voucher.get', 1.3, GET_D),
        at('jde.ap.supplier.get', 1.29, 'supplier.get returns one supplier master record.'),
      ],
      { text: 'get the record' },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.tools).toHaveLength(2);
    expect(v.choose).toBeUndefined();
    expect('choose' in v).toBe(false);
  });

  it('does NOT fire when siblings are separated by more than the margin', () => {
    const v = evaluateFloor(
      [at('jde.ap.voucher.get', 1.4, GET_D), at('jde.ap.voucher.search', 1.3, SEARCH_D)],
      { text: 'get voucher 12345' },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.choose).toBeUndefined();
  });

  it('does NOT synthesise guidance when neither sibling carries disambiguation text', () => {
    const v = evaluateFloor(
      [at('jde.ap.voucher.get', 1.3), at('jde.ap.voucher.search', 1.29)],
      { text: 'voucher' },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.choose).toBeUndefined();
  });

  it('uses the one sibling that carries text when only one does, and never repeats an identical line', () => {
    const one = chooseBlock(
      [at('jde.ap.voucher.get', 1.3, GET_D), at('jde.ap.voucher.search', 1.29)],
      CONFIG,
    );
    expect(one).toBe(GET_D);
    const same = chooseBlock(
      [at('jde.ap.voucher.get', 1.3, GET_D), at('jde.ap.voucher.search', 1.29, GET_D)],
      CONFIG,
    );
    expect(same).toBe(GET_D);
  });

  it('needs two results — a single survivor is never ambiguous', () => {
    expect(chooseBlock([at('jde.ap.voucher.get', 1.3, GET_D)], CONFIG)).toBeNull();
  });

  it('reads the top two SURVIVORS, not the top two ranked — a below-floor tool is not a choice', () => {
    const v = evaluateFloor(
      [
        at('jde.ap.voucher.get', 1.3, GET_D),
        at('jde.ap.voucher.search', 0.99, SEARCH_D), // below the floor
        at('jde.ap.supplier.get', 0.98),
      ],
      { text: 'voucher' },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.tools.map((t) => t.id)).toEqual(['jde.ap.voucher.get']);
    expect(v.choose).toBeUndefined();
  });

  it('is decided before the limit truncates, so asking for one card does not hide the ambiguity', () => {
    const v = evaluateFloor(
      [at('jde.ap.voucher.get', 1.3, GET_D), at('jde.ap.voucher.search', 1.28, SEARCH_D)],
      { text: 'voucher', limit: 1 },
      CONFIG,
    );
    if (v.result !== 'tools') throw new Error('expected tools');
    expect(v.tools).toHaveLength(1);
    expect(v.choose).toBe(`${GET_D} ${SEARCH_D}`);
  });
});

describe('stage 6 inside the real pipeline', () => {
  const index = indexOf(
    toolInput({
      id: 'jde.ap.voucher.get',
      title: 'Get a voucher',
      purpose: 'Return one voucher by document number.',
      entity: 'voucher',
      verb: 'get',
      write: false,
    }),
    toolInput({
      id: 'jde.ap.voucher.search',
      title: 'Search vouchers',
      purpose: 'Find vouchers by supplier, date or amount.',
      entity: 'voucher',
      verb: 'search',
      write: false,
    }),
  );

  it('substitutes for PASS_THROUGH_FLOOR without changing anything else about the ranking', () => {
    const visibility = seeAll(index);
    const query = { text: 'get voucher by document number' };
    const open = rankTools(index, query, { visibility });
    const floored = rankTools(index, query, {
      visibility,
      floor: createScoreFloorPolicy(DEFAULT_FLOOR_CONFIG),
    });
    expect(floored.length).toBeLessThanOrEqual(open.length);
    expect(floored.map((r) => r.id)).toEqual(
      open.filter((r) => r.score >= DEFAULT_FLOOR_CONFIG.floor).map((r) => r.id),
    );
    expect(floored[0]?.id).toBe('jde.ap.voucher.get');
  });

  it('an out-of-catalogue intent clears nothing at the committed floor', () => {
    const ranked = rankTools(
      index,
      { text: 'adjust an employee payroll deduction' },
      {
        visibility: seeAll(index),
      },
    );
    const v = evaluateFloor(ranked, { text: 'adjust an employee payroll deduction' });
    expect(v.result).toBe('no_tool');
  });
});
