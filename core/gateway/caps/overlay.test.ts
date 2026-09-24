import { describe, expect, it } from 'vitest';
import { HARD_CEILINGS } from './ceilings.js';
import {
  loadCapsOverlayFile,
  loadEffectiveCaps,
  parseCapsOverlayFile,
  resolveEffectiveCaps,
} from './overlay.js';

const VALID_YAML = `
apiVersion: mcpforge/v1
kind: Caps
deployment: local
caps:
  rowCap: 500
  perToolRateLimitPerMinute: 60
`;

describe('parseCapsOverlayFile', () => {
  it('parses a well-formed overlay', () => {
    const result = parseCapsOverlayFile('caps.yaml', VALID_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.deployment).toBe('local');
    expect(result.doc.caps.rowCap).toBe(500);
    expect(result.doc.caps.perToolRateLimitPerMinute).toBe(60);
  });

  it('accepts an overlay declaring no caps at all', () => {
    const result = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.caps).toEqual({});
  });

  it('rejects invalid YAML', () => {
    const result = parseCapsOverlayFile('caps.yaml', '::: not yaml :::');
    expect(result.ok).toBe(false);
  });

  it('rejects the wrong apiVersion', () => {
    const result = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: v2\nkind: Caps\ndeployment: local\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toMatch(/apiVersion/);
  });

  it('rejects the wrong kind', () => {
    const result = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: mcpforge/v1\nkind: NotCaps\ndeployment: local\n',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a cap name outside the closed six', () => {
    const result = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\ncaps:\n  bogusCap: 5\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toMatch(/bogusCap/);
  });

  it('rejects a negative or non-integer cap value', () => {
    const negative = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\ncaps:\n  rowCap: -5\n',
    );
    expect(negative.ok).toBe(false);
    const fractional = parseCapsOverlayFile(
      'caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\ncaps:\n  rowCap: 5.5\n',
    );
    expect(fractional.ok).toBe(false);
  });
});

describe('loadCapsOverlayFile', () => {
  it('returns doc: null (not an error) for a missing file — no overlay tightens nothing', () => {
    const result = loadCapsOverlayFile('C:/does/not/exist/caps.yaml');
    expect(result).toEqual({ ok: true, doc: null });
  });
});

describe('resolveEffectiveCaps — the ONE-DIRECTIONAL merge (the load-bearing test)', () => {
  it('a missing overlay yields every cap at its compiled-in ceiling', () => {
    const effective = resolveEffectiveCaps(null);
    expect(effective).toEqual(HARD_CEILINGS);
  });

  it('an overlay value BELOW the ceiling tightens exactly as declared', () => {
    const effective = resolveEffectiveCaps({ rowCap: 100 });
    expect(effective.rowCap).toBe(100);
    // every other cap is untouched, still at its ceiling
    expect(effective.responseByteCap).toBe(HARD_CEILINGS.responseByteCap);
  });

  it('CANNOT LOOSEN: an overlay value ABOVE the compiled-in ceiling is clamped to the ceiling, never honoured', () => {
    const aboveCeiling = HARD_CEILINGS.rowCap + 1_000_000;
    const effective = resolveEffectiveCaps({ rowCap: aboveCeiling });
    expect(effective.rowCap).toBe(HARD_CEILINGS.rowCap);
    expect(effective.rowCap).not.toBe(aboveCeiling);
  });

  it('CANNOT LOOSEN, proved for every one of the six caps at once', () => {
    const allAboveCeiling = {
      rowCap: HARD_CEILINGS.rowCap * 10,
      responseByteCap: HARD_CEILINGS.responseByteCap * 10,
      perToolRateLimitPerMinute: HARD_CEILINGS.perToolRateLimitPerMinute * 10,
      perCallerRateLimitPerMinute: HARD_CEILINGS.perCallerRateLimitPerMinute * 10,
      perBindingConcurrency: HARD_CEILINGS.perBindingConcurrency * 10,
      globalConcurrency: HARD_CEILINGS.globalConcurrency * 10,
    };
    const effective = resolveEffectiveCaps(allAboveCeiling);
    expect(effective).toEqual(HARD_CEILINGS);
  });

  it('a zero overlay value tightens all the way to zero (a deployment may lock a cap fully closed)', () => {
    const effective = resolveEffectiveCaps({ globalConcurrency: 0 });
    expect(effective.globalConcurrency).toBe(0);
  });
});

describe('loadEffectiveCaps', () => {
  it('a missing overlay file resolves to the ceilings unchanged', () => {
    const result = loadEffectiveCaps('C:/does/not/exist/caps.yaml');
    expect(result).toEqual({ ok: true, caps: HARD_CEILINGS });
  });
});
