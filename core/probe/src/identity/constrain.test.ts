// W0-H5 — 02 §3.5's / 01 §8 R1's AUTOMATIC constraint, exhaustively.

import { describe, expect, it } from 'vitest';
import { SENSITIVITIES } from '@mcpforge/shared';
import {
  IDENTITY_CARRIAGES,
  LOW_SENSITIVITY_CEILING,
  NON_CARRIAGE_DISPOSITIONS,
  isLowSensitivity,
} from './carriage.js';
import { constrainForCarriage } from './constrain.js';

const TOOL = 'jde.ap.voucher.create';

describe('constrainForCarriage — verified', () => {
  it('applies no constraint and disables nothing', () => {
    for (const write of [true, false]) {
      const c = constrainForCarriage({ toolId: TOOL, carries: 'verified', write });
      expect(c.status).toBeNull();
      expect(c.disabled).toBe(false);
    }
  });
});

describe('constrainForCarriage — no (a service account came back)', () => {
  it('auto-disables a WRITE tool full stop, whatever the disposition says', () => {
    for (const onNonCarriage of [...NON_CARRIAGE_DISPOSITIONS, null, 'nonsense']) {
      for (const sensitivity of SENSITIVITIES) {
        const c = constrainForCarriage({
          toolId: TOOL,
          carries: 'no',
          write: true,
          onNonCarriage,
          sensitivity,
        });
        expect(c.status).toBe('disabled_identity_unverified');
        expect(c.disabled).toBe(true);
      }
    }
  });

  it('auto-disables a read under `block`', () => {
    const c = constrainForCarriage({
      toolId: TOOL,
      carries: 'no',
      write: false,
      onNonCarriage: 'block',
      sensitivity: 'public',
    });
    expect(c.disabled).toBe(true);
    expect(c.status).toBe('disabled_identity_unverified');
  });

  it('degrades a LOW-sensitivity read to read-only under `readonly-lowsens`', () => {
    for (const sensitivity of SENSITIVITIES.filter((s) => isLowSensitivity(s))) {
      const c = constrainForCarriage({
        toolId: TOOL,
        carries: 'no',
        write: false,
        onNonCarriage: 'readonly-lowsens',
        sensitivity,
      });
      expect(c.status).toBe('degraded_readonly');
      expect(c.disabled).toBe(false);
    }
  });

  it('still blocks a read ABOVE the low-sensitivity ceiling — a conjunction, not a menu', () => {
    for (const sensitivity of SENSITIVITIES.filter((s) => !isLowSensitivity(s))) {
      const c = constrainForCarriage({
        toolId: TOOL,
        carries: 'no',
        write: false,
        onNonCarriage: 'readonly-lowsens',
        sensitivity,
      });
      expect(c.status).toBe('disabled_identity_unverified');
      expect(c.disabled).toBe(true);
      expect(c.detail).toContain(LOW_SENSITIVITY_CEILING);
    }
  });

  it('blocks a read whose sensitivity is absent or unrecognised', () => {
    for (const sensitivity of [null, undefined, 'ultra-secret']) {
      expect(
        constrainForCarriage({
          toolId: TOOL,
          carries: 'no',
          write: false,
          onNonCarriage: 'readonly-lowsens',
          sensitivity,
        }).disabled,
      ).toBe(true);
    }
  });

  it('falls back to `block` on an absent or unrecognised disposition, and SAYS so', () => {
    for (const onNonCarriage of [null, undefined, '', 'allow', 'readonly']) {
      const c = constrainForCarriage({
        toolId: TOOL,
        carries: 'no',
        write: false,
        onNonCarriage,
        sensitivity: 'public',
      });
      expect(c.disposition).toBe('block');
      expect(c.disabled).toBe(true);
      expect(c.detail).toContain('block');
    }
  });
});

describe('constrainForCarriage — unverified', () => {
  it('auto-disables reads and writes alike; never "assumed fine"', () => {
    for (const write of [true, false]) {
      for (const onNonCarriage of NON_CARRIAGE_DISPOSITIONS) {
        const c = constrainForCarriage({
          toolId: TOOL,
          carries: 'unverified',
          write,
          onNonCarriage,
          sensitivity: 'public',
        });
        expect(c.status).toBe('disabled_identity_unverified');
        expect(c.disabled).toBe(true);
      }
    }
  });
});

describe('constrainForCarriage — totality', () => {
  it('every combination yields a decided outcome and a non-empty detail', () => {
    for (const carries of IDENTITY_CARRIAGES) {
      for (const write of [true, false]) {
        for (const onNonCarriage of [...NON_CARRIAGE_DISPOSITIONS, null]) {
          for (const sensitivity of [...SENSITIVITIES, null]) {
            const c = constrainForCarriage({
              toolId: TOOL,
              carries,
              write,
              onNonCarriage,
              sensitivity,
            });
            expect(c.detail.trim().length).toBeGreaterThan(0);
            expect(c.detail).toContain(TOOL);
            // `disabled` and `status` can never disagree.
            expect(c.disabled).toBe(c.status === 'disabled_identity_unverified');
            // The only two statuses an identity verdict may ever force.
            expect([null, 'disabled_identity_unverified', 'degraded_readonly']).toContain(c.status);
            // A WRITE tool is never published on anything but `verified`.
            if (write && carries !== 'verified') expect(c.disabled).toBe(true);
          }
        }
      }
    }
  });
});
