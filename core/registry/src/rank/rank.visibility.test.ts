// MCPForge — the stage 1 proof. W0-G2, 02 §5.4.2:
//   "A tool the caller cannot reach is never ranked, never returned."
//
// The claim under test is deliberately stronger than "ranked low". Each test
// below closes one route by which an unreachable tool could become
// observable: appearing in the output, appearing when it is the ONLY textual
// match, influencing the scores of the tools that are returned, or being
// rescued by a boost or a filter.

import { describe, expect, it } from 'vitest';
import { applyHardFilters } from './filter.js';
import { rankTools } from './pipeline.js';
import { indexOf, nearMissIndex, positionOf, seeAll, seeOnly, toolInput } from './rank.fixtures.js';

const HIDDEN = 'jde.ap.voucher.get';

describe('stage 1 — visible(session) is applied before ranking', () => {
  it('never returns a tool outside visible(session), at any rank', () => {
    const index = nearMissIndex();
    const visible = index.tools.map((t) => t.id).filter((id) => id !== HIDDEN);

    const ranked = rankTools(
      index,
      { text: 'get a voucher by document number' },
      {
        visibility: seeOnly(visible),
      },
    );

    expect(positionOf(ranked, HIDDEN)).toBe(-1);
    expect(ranked.map((r) => r.id)).toEqual(expect.arrayContaining(['jde.ap.voucher.search']));
    // And the same query with the tool visible DOES return it — otherwise the
    // assertion above would pass for the wrong reason.
    const wide = rankTools(
      index,
      { text: 'get a voucher by document number' },
      { visibility: seeAll(index) },
    );
    expect(positionOf(wide, HIDDEN)).toBe(0);
  });

  it('returns nothing at all when the one perfect match is out of scope', () => {
    const index = nearMissIndex();
    const ranked = rankTools(index, { text: 'voucher' }, { visibility: seeOnly([]) });
    expect(ranked).toEqual([]);
  });

  it('does not let an invisible tool influence the scores of visible ones (it is not in the corpus)', () => {
    // Two identical worlds, differing only by an extra, invisible tool that
    // shares the query's rarest term. If stage 1 ran after scoring — or if
    // BM25 took its document frequencies from the whole index — the extra
    // tool would change IDF and move the returned scores.
    const base = [
      toolInput({ id: 'jde.ap.voucher.get', entity: 'voucher', verb: 'get', write: false }),
      toolInput({
        id: 'jde.gl.journal.get',
        module: 'gl',
        entity: 'journal',
        verb: 'get',
        write: false,
      }),
    ];
    const withoutIntruder = indexOf(...base);
    const withIntruder = indexOf(
      ...base,
      toolInput({ id: 'zz.ap.voucher.cancel', entity: 'voucher', verb: 'cancel', write: false }),
    );

    const query = { text: 'voucher' };
    const a = rankTools(withoutIntruder, query, { visibility: seeAll(withoutIntruder) });
    const b = rankTools(withIntruder, query, {
      visibility: seeOnly(base.map((t) => t.id)),
    });

    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(b.map((r) => r.score)).toEqual(a.map((r) => r.score));
  });

  it('cannot be rescued by a boost — an out-of-scope tool the query names exactly is still absent', () => {
    const index = nearMissIndex();
    const ranked = rankTools(
      index,
      { text: 'get voucher' },
      { visibility: seeOnly(['jde.gl.journal.get'], ['p2p']) },
    );
    expect(ranked.map((r) => r.id)).toEqual(['jde.gl.journal.get']);
  });

  it('cannot be rescued by a structured filter naming it', () => {
    const index = nearMissIndex();
    const ranked = rankTools(
      index,
      { text: '', filters: { entity: 'voucher', verb: 'get' } },
      { visibility: seeOnly(['jde.ap.supplier.get']) },
    );
    expect(ranked).toEqual([]);
  });

  it('applies visibility and structured filters conjunctively, in that order', () => {
    const index = nearMissIndex();
    const survivors = applyHardFilters(
      index.tools,
      seeOnly(['jde.ap.voucher.get', 'jde.ap.supplier.get']),
      {
        entity: 'voucher',
      },
    );
    expect(survivors.map((s) => s.id)).toEqual(['jde.ap.voucher.get']);
  });
});
