import { describe, expect, it } from 'vitest';
import { CAP_NAMES, HARD_CEILINGS, isValidCapValue } from './ceilings.js';

describe('HARD_CEILINGS', () => {
  it('defines exactly the six caps 02 §4.7 names', () => {
    expect(new Set(Object.keys(HARD_CEILINGS))).toEqual(new Set(CAP_NAMES));
  });

  it('every ceiling is a positive integer', () => {
    for (const name of CAP_NAMES) {
      expect(isValidCapValue(HARD_CEILINGS[name])).toBe(true);
      expect(HARD_CEILINGS[name]).toBeGreaterThan(0);
    }
  });

  it('is frozen so nothing can mutate the compiled-in ceiling at runtime', () => {
    expect(Object.isFrozen(HARD_CEILINGS)).toBe(true);
    expect(() => {
      (HARD_CEILINGS as Record<string, number>)['rowCap'] = 999_999;
    }).toThrow();
  });
});

describe('isValidCapValue', () => {
  it('accepts non-negative integers', () => {
    expect(isValidCapValue(0)).toBe(true);
    expect(isValidCapValue(42)).toBe(true);
  });

  it('rejects negatives, non-integers, non-numbers', () => {
    expect(isValidCapValue(-1)).toBe(false);
    expect(isValidCapValue(1.5)).toBe(false);
    expect(isValidCapValue('5')).toBe(false);
    expect(isValidCapValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidCapValue(undefined)).toBe(false);
  });
});
