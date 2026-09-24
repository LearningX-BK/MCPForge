// MCPForge — the consumption tiebreak's cap. W0-G2, 02 §5.4.2 stage 5:
//   "+ tiny tiebreak on consumption count (capped, so a popular tool cannot
//      bury a correct rare one)"
//
// The cap is 0.01 and it is DERIVED, not chosen: strictly below
// `ADJACENT_RANK_GAP` (≈ 0.0164), the normalised fusion distance between two
// neighbouring lexical ranks. The tests below assert the derivation, the
// saturation, and the consequence the doc actually cares about.

import { describe, expect, it } from 'vitest';
import { consumptionTiebreak } from './boosts.js';
import { rankTools } from './pipeline.js';
import {
  ADJACENT_RANK_GAP,
  ACTIVE_ROLE_BOOST,
  CONSUMPTION_REFERENCE_COUNT,
  CONSUMPTION_TIEBREAK_CAP,
  DEFAULT_RANK_WEIGHTS,
} from './weights.js';
import { indexOf, seeAll, toolInput } from './rank.fixtures.js';

describe('the consumption tiebreak is capped', () => {
  it('the cap is strictly below the fusion gap between two adjacent lexical ranks', () => {
    expect(CONSUMPTION_TIEBREAK_CAP).toBeLessThan(ADJACENT_RANK_GAP);
    // …and an order of magnitude below the smallest deterministic boost, so it
    // can never out-argue an active role either.
    expect(CONSUMPTION_TIEBREAK_CAP).toBeLessThan(ACTIVE_ROLE_BOOST);
  });

  it('never exceeds the cap, for any count', () => {
    for (const count of [
      1,
      10,
      999,
      CONSUMPTION_REFERENCE_COUNT,
      1e6,
      1e9,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const index = indexOf(toolInput());
      const value = consumptionTiebreak(
        index.tools[0]!,
        new Map([['jde.ap.voucher.create', count]]),
        DEFAULT_RANK_WEIGHTS,
      );
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(CONSUMPTION_TIEBREAK_CAP);
    }
  });

  it('saturates: 10^9 calls is worth exactly what 10^3 calls is worth', () => {
    const index = indexOf(toolInput());
    const at = (count: number) =>
      consumptionTiebreak(
        index.tools[0]!,
        new Map([['jde.ap.voucher.create', count]]),
        DEFAULT_RANK_WEIGHTS,
      );
    expect(at(1e9)).toBe(CONSUMPTION_TIEBREAK_CAP);
    expect(at(CONSUMPTION_REFERENCE_COUNT)).toBe(CONSUMPTION_TIEBREAK_CAP);
    // …but it still distinguishes never-used from lightly-used.
    expect(at(0)).toBe(0);
    expect(at(5)).toBeGreaterThan(0);
    expect(at(5)).toBeLessThan(at(200));
  });

  it('THE CLAIM: a wildly popular tool cannot bury a correct rare one', () => {
    // `voucher.search` is the popular one and its lexical document mentions
    // the query terms often. `voucher.get` is the correct, rarely-used one:
    // the query names its verb, and that is the only reason it should win.
    const index = indexOf(
      toolInput({
        id: 'jde.ap.voucher.search',
        title: 'Search vouchers',
        purpose: 'Search vouchers, search vouchers, search vouchers by supplier.',
        entity: 'voucher',
        verb: 'search',
        write: false,
      }),
      toolInput({
        id: 'jde.ap.voucher.get',
        title: 'Get a voucher',
        purpose: 'Return one voucher.',
        entity: 'voucher',
        verb: 'get',
        write: false,
      }),
    );
    const consumption = new Map([
      ['jde.ap.voucher.search', 1_000_000_000],
      ['jde.ap.voucher.get', 0],
    ]);

    const ranked = rankTools(
      index,
      { text: 'get voucher 4711' },
      {
        visibility: seeAll(index),
        consumption,
      },
    );
    expect(ranked[0]!.id).toBe('jde.ap.voucher.get');
  });

  it('cannot invert two tools the lexical channel separated by even one rank', () => {
    // Same score everywhere except fusion rank and consumption. `rare` is
    // lexically first; `popular` has every call ever made.
    const index = indexOf(
      toolInput({
        id: 'jde.ap.voucher.get',
        title: 'Voucher voucher voucher',
        purpose: 'Voucher.',
        entity: 'voucher',
        verb: 'get',
        write: false,
      }),
      toolInput({
        id: 'jde.ap.voucher.list',
        title: 'Voucher',
        purpose: 'Voucher.',
        entity: 'voucher',
        verb: 'list',
        write: false,
      }),
    );
    const ranked = rankTools(
      index,
      { text: 'voucher' },
      {
        visibility: seeAll(index),
        consumption: new Map([['jde.ap.voucher.list', Number.MAX_SAFE_INTEGER]]),
      },
    );
    expect(ranked[0]!.id).toBe('jde.ap.voucher.get');
    expect(ranked[0]!.breakdown.fusion).toBeGreaterThan(ranked[1]!.breakdown.fusion);
    expect(ranked[1]!.breakdown.consumption).toBe(CONSUMPTION_TIEBREAK_CAP);
  });

  it('does break an exact tie — that is what it is for', () => {
    const index = indexOf(
      toolInput({ id: 'jde.ap.voucher.get', entity: 'voucher', verb: 'get', write: false }),
      toolInput({
        id: 'zz.ap.voucher.get',
        app: 'zz',
        entity: 'voucher',
        verb: 'get',
        write: false,
      }),
    );
    const tied = rankTools(index, { text: '' }, { visibility: seeAll(index) });
    expect(tied[0]!.score).toBe(tied[1]!.score);
    expect(tied[0]!.id).toBe('jde.ap.voucher.get'); // id order, deterministic

    const broken = rankTools(
      index,
      { text: '' },
      {
        visibility: seeAll(index),
        consumption: new Map([['zz.ap.voucher.get', 500]]),
      },
    );
    expect(broken[0]!.id).toBe('zz.ap.voucher.get');
  });

  it('treats a corrupt or negative counter as zero rather than throwing', () => {
    const index = indexOf(toolInput());
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        consumptionTiebreak(
          index.tools[0]!,
          new Map([['jde.ap.voucher.create', bad]]),
          DEFAULT_RANK_WEIGHTS,
        ),
      ).toBe(0);
    }
  });
});
