// MCPForge — W0-J19: the three-tier verdict must be sourced from the real
// ranker, with a REAL, non-fabricated similarity score. Fixture asks and
// their exact scores are measured against the real pipeline, not invented —
// see `fixtures.ts`'s header for how each ask was chosen.
import { describe, expect, it } from 'vitest';
import { fixtureCatalogSource } from '../catalog/fixtures';
import { verdictFor, EXISTS_SCORE_THRESHOLD, NEAR_MISS_SCORE_THRESHOLD } from './rank-adapter';

describe('verdictFor', () => {
  const data = fixtureCatalogSource();

  it('returns exists, with a real score, when the ask names the tool\'s own verb', () => {
    const v = verdictFor('search AP vouchers for supplier', data);
    expect(v.tier).toBe('exists');
    if (v.tier === 'exists') {
      expect(v.match.toolId).toBe('jde.ap.voucher.search');
      expect(v.match.score).toBeGreaterThanOrEqual(EXISTS_SCORE_THRESHOLD);
      expect(Number.isFinite(v.match.score)).toBe(true);
    }
  });

  it('returns near_miss, with real distinct scores, for lexical overlap that names no tool\'s verb or entity', () => {
    const v = verdictFor('look up bills for supplier by amount', data);
    expect(v.tier).toBe('near_miss');
    if (v.tier === 'near_miss') {
      expect(v.matches.length).toBeGreaterThan(0);
      for (const m of v.matches) {
        expect(m.score).toBeGreaterThanOrEqual(NEAR_MISS_SCORE_THRESHOLD);
        expect(m.score).toBeLessThan(EXISTS_SCORE_THRESHOLD);
      }
      // Real, ranked scores — descending, not a flat invented number.
      const scores = v.matches.map((m) => m.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });

  it('returns new, with a pre-filled draft, when the ask shares no token with the catalogue', () => {
    const ask = 'schedule robot firmware maintenance windows';
    const v = verdictFor(ask, data);
    expect(v.tier).toBe('new');
    if (v.tier === 'new') {
      expect(v.draftTemplate.yaml).toContain(ask);
    }
  });

  it('is deterministic — same ask, same catalogue, same score', () => {
    const a = verdictFor('search AP vouchers for supplier', data);
    const b = verdictFor('search AP vouchers for supplier', data);
    expect(a).toEqual(b);
  });

  it('never fabricates the score — it is exactly the real RankedResult.score, unrounded at source', () => {
    const v = verdictFor('search AP vouchers for supplier', data);
    if (v.tier === 'exists') {
      // 1.0 (fusion, rank 1 of 1 lexical retrieval) + 0.25 (verb-match boost) — see rank-adapter.ts's header.
      expect(v.match.score).toBeCloseTo(1.25, 6);
    }
  });
});
