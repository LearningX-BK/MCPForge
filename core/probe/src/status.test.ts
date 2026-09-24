// The closed enum, and the drift guard against the package that READS it.

import { describe, expect, it } from 'vitest';
import {
  PROBE_STATUSES as GATEWAY_STATUSES,
  PROBE_ENABLED_STATUSES as GATEWAY_ENABLED,
} from '@mcpforge/gateway/scope';
import {
  CHECK_FAILURE_STATUSES,
  PROBE_ENABLED_STATUSES,
  PROBE_STATUSES,
  STATUS_PRECEDENCE,
  isProbeStatus,
} from './status.js';

describe('the closed probe status enum', () => {
  it("is exactly 02 §4.5's seven values, in the order the document lists them", () => {
    expect([...PROBE_STATUSES]).toEqual([
      'resolved',
      'degraded_readonly',
      'disabled_missing_binding',
      'disabled_no_grant',
      'disabled_identity_unverified',
      'disabled_schema_drift',
      'disabled_kill_switch',
    ]);
  });

  it('matches the list core/gateway/scope reads — the writer and the reader cannot drift', () => {
    expect([...PROBE_STATUSES]).toEqual([...GATEWAY_STATUSES]);
    expect([...PROBE_ENABLED_STATUSES].sort()).toEqual([...GATEWAY_ENABLED].sort());
  });

  it('has a precedence list that is total over the enum and ends in resolved', () => {
    expect([...STATUS_PRECEDENCE].sort()).toEqual([...PROBE_STATUSES].sort());
    expect(STATUS_PRECEDENCE).toHaveLength(PROBE_STATUSES.length);
    expect(STATUS_PRECEDENCE[STATUS_PRECEDENCE.length - 1]).toBe('resolved');
  });

  it('never lets a check select resolved or disabled_kill_switch', () => {
    expect(CHECK_FAILURE_STATUSES).not.toContain('resolved');
    expect(CHECK_FAILURE_STATUSES).not.toContain('disabled_kill_switch');
    for (const s of CHECK_FAILURE_STATUSES) expect(isProbeStatus(s)).toBe(true);
  });

  it('rejects anything outside the enum — there is no third state', () => {
    for (const invented of ['unknown', 'pending', 'unresolved', 'disabled', 'ok', '']) {
      expect(isProbeStatus(invented)).toBe(false);
    }
  });
});
