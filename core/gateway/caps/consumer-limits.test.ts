// MCPForge — W0-N7's tighten-never-loosen proof for consumer-level quotas,
// matching `overlay.test.ts`'s existing discipline for the six process-wide
// caps (02 §4.7). `resolveEffectiveConsumerLimits` is the merge under test —
// no `process.cwd()` anywhere in this file, no fixture files at all.

import { describe, expect, it } from 'vitest';
import { CONSUMER_LIMIT_CEILINGS, resolveEffectiveConsumerLimits } from './consumer-limits.js';
import { parseConsumerLimitsOverlayFile } from './consumer-limits.js';
import { parse as parseYaml } from 'yaml';

const CONSUMER_DECLARED = { callsPerMinute: 120, writesPerDay: 200 } as const;

describe('resolveEffectiveConsumerLimits', () => {
  it('with no overlay, resolves to the consumer-declared value (below the ceiling)', () => {
    const effective = resolveEffectiveConsumerLimits(CONSUMER_DECLARED, null);
    expect(effective.callsPerMinute).toBe(120);
    expect(effective.writesPerDay).toBe(200);
  });

  it('an overlay value BELOW the consumer-declared value tightens exactly as declared', () => {
    const effective = resolveEffectiveConsumerLimits(CONSUMER_DECLARED, { callsPerMinute: 10 });
    expect(effective.callsPerMinute).toBe(10);
    // Untouched dimension is unaffected.
    expect(effective.writesPerDay).toBe(200);
  });

  it('CANNOT LOOSEN: an overlay value ABOVE the consumer-declared value is clamped to the consumer-declared value', () => {
    const effective = resolveEffectiveConsumerLimits(CONSUMER_DECLARED, { callsPerMinute: 9_999 });
    expect(effective.callsPerMinute).toBe(120);
  });

  it('CANNOT LOOSEN PAST THE COMPILED-IN CEILING: a consumer record that (impossibly) declared above the ceiling is itself clamped', () => {
    const overDeclared = { callsPerMinute: CONSUMER_LIMIT_CEILINGS.callsPerMinute + 5_000, writesPerDay: 10 };
    const effective = resolveEffectiveConsumerLimits(overDeclared, null);
    expect(effective.callsPerMinute).toBe(CONSUMER_LIMIT_CEILINGS.callsPerMinute);
  });

  it('CANNOT LOOSEN PAST THE COMPILED-IN CEILING: an overlay asking for MORE than the ceiling is refused the loosening even though it is below what the consumer declared', () => {
    const declaredAtCeiling = {
      callsPerMinute: CONSUMER_LIMIT_CEILINGS.callsPerMinute,
      writesPerDay: 10,
    };
    const effective = resolveEffectiveConsumerLimits(declaredAtCeiling, {
      callsPerMinute: CONSUMER_LIMIT_CEILINGS.callsPerMinute + 1,
    });
    expect(effective.callsPerMinute).toBe(CONSUMER_LIMIT_CEILINGS.callsPerMinute);
  });

  it('a zero overlay value tightens all the way to zero (an incident-response full lock)', () => {
    const effective = resolveEffectiveConsumerLimits(CONSUMER_DECLARED, { writesPerDay: 0 });
    expect(effective.writesPerDay).toBe(0);
  });
});

describe('parseConsumerLimitsOverlayFile', () => {
  it('parses a well-formed overlay keyed by consumer id', () => {
    const yaml = `
apiVersion: mcpforge/v1
kind: ConsumerLimits
deployment: local
limits:
  jde-agent-1:
    callsPerMinute: 10
    writesPerDay: 5
`;
    const result = parseConsumerLimitsOverlayFile('consumer-limits.yaml', parseYaml(yaml));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.limits['jde-agent-1']).toEqual({ callsPerMinute: 10, writesPerDay: 5 });
  });

  it('accepts an overlay declaring no consumer overrides at all', () => {
    const result = parseConsumerLimitsOverlayFile(
      'consumer-limits.yaml',
      parseYaml('apiVersion: mcpforge/v1\nkind: ConsumerLimits\ndeployment: local\n'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.doc.limits).toEqual({});
  });

  it('rejects the wrong kind', () => {
    const result = parseConsumerLimitsOverlayFile(
      'consumer-limits.yaml',
      parseYaml('apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\n'),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a limit name outside the closed two', () => {
    const result = parseConsumerLimitsOverlayFile(
      'consumer-limits.yaml',
      parseYaml(
        'apiVersion: mcpforge/v1\nkind: ConsumerLimits\ndeployment: local\nlimits:\n  a:\n    bogusLimit: 5\n',
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toMatch(/bogusLimit/);
  });

  it('rejects a negative or non-integer limit value', () => {
    const result = parseConsumerLimitsOverlayFile(
      'consumer-limits.yaml',
      parseYaml(
        'apiVersion: mcpforge/v1\nkind: ConsumerLimits\ndeployment: local\nlimits:\n  a:\n    callsPerMinute: -1\n',
      ),
    );
    expect(result.ok).toBe(false);
  });
});
