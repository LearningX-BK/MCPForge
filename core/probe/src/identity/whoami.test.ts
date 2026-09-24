// W0-H5 — the `MCPFORGE_PROBE_WHOAMI` comparison. 02 §3.5's three branches.

import { describe, expect, it } from 'vitest';
import {
  PROBE_WHOAMI_ORCHESTRATION,
  WHOAMI_IDENTITY_KEYS,
  compareWhoami,
  readWhoamiIdentity,
} from './whoami.js';
import { IDENTITY_CARRIAGES } from './carriage.js';

const TOOL = 'jde.ap.voucher.create';

describe('readWhoamiIdentity — a closed, ordered key list, never a guess', () => {
  it('reads every documented key', () => {
    for (const key of WHOAMI_IDENTITY_KEYS) {
      expect(readWhoamiIdentity({ [key]: 'TESTUSER01' })).toBe('TESTUSER01');
    }
  });

  it('prefers MCPForge’s own canonical key when several are present', () => {
    expect(readWhoamiIdentity({ user: 'SVC', identity: 'TESTUSER01' })).toBe('TESTUSER01');
  });

  it('reads no identity out of an unknown key, a blank value, or a non-object', () => {
    expect(readWhoamiIdentity({ executedBy: 'TESTUSER01' })).toBeNull();
    expect(readWhoamiIdentity({ identity: '   ' })).toBeNull();
    expect(readWhoamiIdentity({ identity: 42 })).toBeNull();
    expect(readWhoamiIdentity([{ identity: 'X' }])).toBeNull();
    expect(readWhoamiIdentity(null)).toBeNull();
    expect(readWhoamiIdentity('TESTUSER01')).toBeNull();
  });
});

describe('compareWhoami — 02 §3.5, and only its three branches', () => {
  it('equal -> verified', () => {
    const c = compareWhoami({
      toolId: TOOL,
      testIdentity: 'TESTUSER01',
      outcome: { kind: 'observed', observed: 'TESTUSER01' },
    });
    expect(c.carries).toBe('verified');
    expect(c.observed).toBe('TESTUSER01');
    expect(c.detail).toContain(PROBE_WHOAMI_ORCHESTRATION);
  });

  it('tolerates case and surrounding whitespace, which Oracle targets vary', () => {
    expect(
      compareWhoami({
        toolId: TOOL,
        testIdentity: 'testuser01',
        outcome: { kind: 'observed', observed: '  TESTUSER01 ' },
      }).carries,
    ).toBe('verified');
  });

  it('does NOT match on a prefix, a substring or a domain-stripped form', () => {
    for (const observed of ['TESTUSER011', 'TESTUSER', 'TESTUSER01@LTM', 'LTM\\TESTUSER01']) {
      expect(
        compareWhoami({
          toolId: TOOL,
          testIdentity: 'TESTUSER01',
          outcome: { kind: 'observed', observed },
        }).carries,
      ).toBe('no');
    }
  });

  it('a service account came back -> no, and the detail names both identities', () => {
    const c = compareWhoami({
      toolId: TOOL,
      testIdentity: 'TESTUSER01',
      outcome: { kind: 'observed', observed: 'SVC_MCPFORGE' },
    });
    expect(c.carries).toBe('no');
    expect(c.detail).toContain('SVC_MCPFORGE');
    expect(c.detail).toContain('TESTUSER01');
  });

  it('missing or erroring probe binding -> unverified, never "assumed fine"', () => {
    const c = compareWhoami({
      toolId: TOOL,
      testIdentity: 'TESTUSER01',
      outcome: { kind: 'error', reason: 'orchestration not found' },
    });
    expect(c.carries).toBe('unverified');
    expect(c.observed).toBeNull();
    expect(c.detail).toContain('orchestration not found');
  });

  it('an answer naming no identity -> unverified, not verified and not no', () => {
    const c = compareWhoami({
      toolId: TOOL,
      testIdentity: 'TESTUSER01',
      outcome: { kind: 'unnamed', reason: 'HTTP 200 response carried no known identity key' },
    });
    expect(c.carries).toBe('unverified');
  });

  it('no configured test identity -> unverified; nothing compares equal to nothing', () => {
    for (const testIdentity of ['', '   ']) {
      const c = compareWhoami({
        toolId: TOOL,
        testIdentity,
        outcome: { kind: 'observed', observed: '' },
      });
      expect(c.carries).toBe('unverified');
    }
  });

  it('every branch returns a member of the closed tri-state and a non-empty detail', () => {
    const outcomes = [
      { kind: 'observed', observed: 'TESTUSER01' },
      { kind: 'observed', observed: 'SVC' },
      { kind: 'unnamed', reason: 'r' },
      { kind: 'error', reason: 'r' },
    ] as const;
    for (const outcome of outcomes) {
      const c = compareWhoami({ toolId: TOOL, testIdentity: 'TESTUSER01', outcome });
      expect(IDENTITY_CARRIAGES).toContain(c.carries);
      expect(c.detail.trim().length).toBeGreaterThan(0);
    }
  });
});
