import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mcpforge/shared';
import {
  BINDING_ERROR_MAP,
  assertMappingEntryIsWellFormed,
  mappingFor,
} from './mapping.js';

const DEAD_END_PHRASES = [
  'try again',
  'please retry',
  'retry later',
  'contact support',
  'an error occurred',
  'unknown error',
];

describe('the binding-layer error mapping (W0-E4, 02 §3.2-§3.6)', () => {
  it('is non-empty and covers every binding type named in 02 §3.2-§3.6', () => {
    expect(BINDING_ERROR_MAP.length).toBeGreaterThan(0);
    const types = new Set(BINDING_ERROR_MAP.map((e) => e.bindingType));
    expect([...types].sort()).toEqual(['database', 'function', 'plsql', 'rest']);
  });

  it('gives Wave 0\'s only real binding type — function — at least six distinct conditions', () => {
    expect(mappingFor('function').length).toBeGreaterThanOrEqual(6);
  });

  it('has no duplicate conditionId within a binding type', () => {
    const seen = new Map<string, Set<string>>();
    for (const e of BINDING_ERROR_MAP) {
      const set = seen.get(e.bindingType) ?? new Set<string>();
      expect(set.has(e.conditionId), `duplicate ${e.bindingType}.${e.conditionId}`).toBe(false);
      set.add(e.conditionId);
      seen.set(e.bindingType, set);
    }
  });

  it.each(BINDING_ERROR_MAP.map((e) => [`${e.bindingType}.${e.conditionId}`, e] as const))(
    '%s maps to a closed code with a non-empty, agent-actionable next',
    (_label, entry) => {
      expect(() => assertMappingEntryIsWellFormed(entry)).not.toThrow();
      expect(ERROR_CODES).toContain(entry.code);
      const lowered = entry.next.toLowerCase();
      for (const phrase of DEAD_END_PHRASES) {
        expect(lowered).not.toContain(phrase);
      }
      // "Names a tool id or a human action" — not a bare restatement of the code.
      expect(entry.next.length).toBeGreaterThan(entry.code.length);
    },
  );

  it('rejects a deliberately-broken entry (proves assertMappingEntryIsWellFormed is not vacuous)', () => {
    expect(() =>
      assertMappingEntryIsWellFormed({
        bindingType: 'function',
        conditionId: 'deliberately-broken',
        code: 'TARGET_ERROR',
        condition: 'x',
        next: '   ',
        retryable: false,
        source: 'test',
      }),
    ).toThrow(/empty next/);
  });
});
