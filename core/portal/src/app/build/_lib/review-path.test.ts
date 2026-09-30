// MCPForge — W0-J14: `expeditedReviewGate` matches the real policy rule's set.
import { describe, expect, it } from 'vitest';
import { ELEVATED_BINDING_TYPES } from '@mcpforge/codegen/rules';
import { expeditedReviewGate } from './review-path';
import { BINDING_TYPES } from '@mcpforge/shared';

describe('expeditedReviewGate (CLAUDE.md non-negotiable #7, 02 §2.2)', () => {
  it('blocks expedited review for every elevated binding type the real policy rule knows', () => {
    for (const type of ELEVATED_BINDING_TYPES) {
      const gate = expeditedReviewGate(type as (typeof BINDING_TYPES)[number]);
      expect(gate.available).toBe(false);
      expect(gate.reason).toBeTruthy();
    }
  });

  it('allows expedited review for every non-elevated binding type', () => {
    for (const type of BINDING_TYPES) {
      if (ELEVATED_BINDING_TYPES.has(type)) continue;
      const gate = expeditedReviewGate(type);
      expect(gate.available).toBe(true);
      expect(gate.reason).toBeUndefined();
    }
  });

  it('the reason names the binding type and CLAUDE.md non-negotiable #7', () => {
    const gate = expeditedReviewGate('plsql');
    expect(gate.reason).toContain('plsql');
    expect(gate.reason).toContain('non-negotiable #7');
  });

  it('treats an undefined binding type as available (no elevated posture asserted yet)', () => {
    expect(expeditedReviewGate(undefined).available).toBe(true);
  });
});
