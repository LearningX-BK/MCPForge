// MCPForge — rotation status arithmetic. W0-N6, 02 §11.5 rule 5.
//
// The interesting assertions here are the BOUNDARIES, because one of them
// (2x the interval) decides an exit code and therefore decides whether a CI
// job or a cron wrapper notices that rotation was skipped.

import { describe, expect, it } from 'vitest';
import { ROTATION_INTERVAL_DAYS, secretRef, type SecretMetadata, type SecretRef } from './types.js';
import { buildRotationReport, rotationStatusFor } from './status.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}

function metadataFor(ref: SecretRef, ageDays: number, rotated = false): SecretMetadata {
  return {
    ref: ref.uri,
    version: rotated ? 2 : 1,
    createdAt: daysAgo(ageDays + 500),
    rotatedAt: rotated ? daysAgo(ageDays) : undefined,
    expiresAt: undefined,
  };
}

const CONSUMER = secretRef('consumer', 'claude-desktop-coe', 'client');
const BINDING = secretRef('binding', 'ebs-p2p-ap', 'wrapper-schema');
const GATEWAY = secretRef('gateway', 'confirm-token', 'hmac');

describe('rotationStatusFor', () => {
  it('takes the interval from the ref SCOPE, per 02 §11.5 rule 5 (consumer 90, binding 180, gateway 90)', () => {
    expect(ROTATION_INTERVAL_DAYS).toEqual({ consumer: 90, binding: 180, gateway: 90 });
    expect(rotationStatusFor(CONSUMER, metadataFor(CONSUMER, 1, true), NOW).intervalDays).toBe(90);
    expect(rotationStatusFor(BINDING, metadataFor(BINDING, 1, true), NOW).intervalDays).toBe(180);
    expect(rotationStatusFor(GATEWAY, metadataFor(GATEWAY, 1, true), NOW).intervalDays).toBe(90);
  });

  it('measures age from the last rotation, falling back to creation', () => {
    const rotated = rotationStatusFor(CONSUMER, metadataFor(CONSUMER, 10, true), NOW);
    expect(rotated.ageDays).toBe(10);
    expect(rotated.rotatedAt).not.toBeNull();

    // Never rotated: age is measured from creation, which is 510 days back.
    const never = rotationStatusFor(CONSUMER, metadataFor(CONSUMER, 10, false), NOW);
    expect(never.ageDays).toBe(510);
    expect(never.rotatedAt).toBeNull();
  });

  it('walks ok -> overdue -> critical across the interval and 2x the interval', () => {
    const state = (age: number): string =>
      rotationStatusFor(CONSUMER, metadataFor(CONSUMER, age, true), NOW).state;
    expect(state(0)).toBe('ok');
    expect(state(89)).toBe('ok');
    // Due today is not yet overdue — strictly greater-than on both thresholds.
    expect(state(90)).toBe('ok');
    expect(state(91)).toBe('overdue');
    expect(state(180)).toBe('overdue');
    expect(state(181)).toBe('critical');
    expect(state(3650)).toBe('critical');
  });

  it('reports next-due and days-until-due, negative once past due', () => {
    const s = rotationStatusFor(CONSUMER, metadataFor(CONSUMER, 100, true), NOW);
    expect(s.nextDueAt).toBe(new Date(NOW.getTime() - 10 * DAY).toISOString());
    expect(s.daysUntilDue).toBe(-10);

    const fresh = rotationStatusFor(CONSUMER, metadataFor(CONSUMER, 10, true), NOW);
    expect(fresh.daysUntilDue).toBe(80);
  });

  it('refuses an unparseable timestamp rather than silently reporting age 0', () => {
    expect(() =>
      rotationStatusFor(CONSUMER, { ...metadataFor(CONSUMER, 1, true), rotatedAt: 'never' }, NOW),
    ).toThrow(/unparseable timestamp/);
  });
});

describe('buildRotationReport', () => {
  const store = (entries: readonly (readonly [SecretRef, number])[]) => ({
    kind: 'encrypted-file',
    list: () => Promise.resolve(entries.map(([ref]) => ref)),
    metadata: (ref: SecretRef) => {
      const found = entries.find(([r]) => r.uri === ref.uri);
      if (found === undefined) return Promise.reject(new Error('no such ref'));
      return Promise.resolve(metadataFor(found[0], found[1], true));
    },
  });

  it('reports every ref, sorted, with counts and the anyCritical flag', async () => {
    const report = await buildRotationReport(
      store([
        [GATEWAY, 5],
        [CONSUMER, 100],
        [BINDING, 400],
      ]),
      NOW,
    );
    expect(report.secrets.map((s) => s.ref)).toEqual([BINDING.uri, CONSUMER.uri, GATEWAY.uri]);
    expect(report.counts).toEqual({ ok: 1, overdue: 1, critical: 1 });
    expect(report.anyCritical).toBe(true);
  });

  it('is clean when nothing is past 2x its interval', async () => {
    const report = await buildRotationReport(
      store([
        [GATEWAY, 5],
        [CONSUMER, 100],
      ]),
      NOW,
    );
    expect(report.counts).toEqual({ ok: 1, overdue: 1, critical: 0 });
    expect(report.anyCritical).toBe(false);
  });

  it('never calls get() — a status report must not resolve a single value', async () => {
    let getCalls = 0;
    const spying = {
      ...store([[CONSUMER, 5]]),
      get: () => {
        getCalls += 1;
        return Promise.reject(new Error('get() must not be called by a status report'));
      },
    };
    await buildRotationReport(spying, NOW);
    expect(getCalls).toBe(0);
  });
});
