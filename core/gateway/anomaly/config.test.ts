// MCPForge — detector configuration is TIGHTEN-ONLY. W0-N8, 02 §11.6 + §4.7.
//
// Adversarial by design: every test here is an overlay trying to make a
// detector less sensitive, less severe, silent, or something it was never
// reviewed to be.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DETECTOR_DEFAULTS,
  loadEffectiveDetectorConfig,
  parseAnomalyDetectorsOverlayFile,
  resolveEffectiveDetectorConfig,
  severityRank,
} from './config.js';
import { ANOMALY_WINDOWS, DETECTOR_IDS } from './types.js';
import { ANOMALY_SEVERITIES } from '../store/anomaly/types.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-anomaly-config-'));

describe('the compiled-in defaults', () => {
  it("declare all SEVEN of 02 §11.6's patterns, so the four Wave 3 ones are visible rather than absent", () => {
    expect(DETECTOR_IDS).toHaveLength(7);
    expect(Object.keys(DETECTOR_DEFAULTS).sort()).toEqual([...DETECTOR_IDS].sort());
  });

  it('never ship a threshold looser than their own compiled floor, and never ship `critical`', () => {
    for (const id of DETECTOR_IDS) {
      const d = DETECTOR_DEFAULTS[id];
      expect(d.threshold).toBeLessThanOrEqual(d.loosestThreshold);
      expect(ANOMALY_WINDOWS).toContain(d.window);
      // `critical` is the only severity carrying an action. Nothing arrives
      // armed by default; arming is a deliberate overlay act.
      expect(d.severity).not.toBe('critical');
    }
  });

  it('are frozen — nothing can rewrite a shipped threshold at runtime', () => {
    expect(Object.isFrozen(DETECTOR_DEFAULTS)).toBe(true);
    expect(() => {
      (DETECTOR_DEFAULTS as unknown as Record<string, unknown>)['burst-write'] = { threshold: 0 };
    }).toThrow(TypeError);
  });
});

describe('resolveEffectiveDetectorConfig — tighten-only, both directions', () => {
  it('with no overlay, every detector runs at its compiled default', () => {
    const resolved = resolveEffectiveDetectorConfig(null);
    for (const id of DETECTOR_IDS) {
      expect(resolved[id].threshold).toBe(DETECTOR_DEFAULTS[id].threshold);
      expect(resolved[id].severity).toBe(DETECTOR_DEFAULTS[id].severity);
      expect(resolved[id].window).toBe(DETECTOR_DEFAULTS[id].window);
    }
  });

  it('an overlay may LOWER a threshold (more sensitive)', () => {
    const resolved = resolveEffectiveDetectorConfig({ 'burst-write': { threshold: 2 } });
    expect(resolved['burst-write'].threshold).toBe(2);
    expect(DETECTOR_DEFAULTS['burst-write'].threshold).toBeGreaterThan(2);
  });

  it('an overlay may NEVER raise a threshold — not by one, not past the floor, not to Infinity', () => {
    for (const attempt of [
      DETECTOR_DEFAULTS['burst-write'].threshold + 1,
      DETECTOR_DEFAULTS['burst-write'].loosestThreshold,
      DETECTOR_DEFAULTS['burst-write'].loosestThreshold + 10_000,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const resolved = resolveEffectiveDetectorConfig({ 'burst-write': { threshold: attempt } });
      expect(resolved['burst-write'].threshold).toBe(DETECTOR_DEFAULTS['burst-write'].threshold);
    }
  });

  it('an overlay may RAISE a severity but never lower one', () => {
    const raised = resolveEffectiveDetectorConfig({ 'burst-write': { severity: 'critical' } });
    expect(raised['burst-write'].severity).toBe('critical');

    for (const lower of ANOMALY_SEVERITIES.filter(
      (s) => severityRank(s) < severityRank(DETECTOR_DEFAULTS['burst-write'].severity),
    )) {
      const resolved = resolveEffectiveDetectorConfig({ 'burst-write': { severity: lower } });
      expect(resolved['burst-write'].severity).toBe(DETECTOR_DEFAULTS['burst-write'].severity);
    }
  });

  it('resolves frozen — a caller downstream cannot mutate a threshold after the merge', () => {
    const resolved = resolveEffectiveDetectorConfig(null);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved['burst-write'])).toBe(true);
    expect(() => {
      (resolved['burst-write'] as unknown as Record<string, unknown>)['threshold'] = 9_999;
    }).toThrow(TypeError);
    expect(() => {
      (resolved['burst-write'] as unknown as Record<string, unknown>)['severity'] = 'low';
    }).toThrow(TypeError);
  });
});

describe('the overlay file schema', () => {
  const header = 'apiVersion: mcpforge/v1\nkind: AnomalyDetectors\ndeployment: local\n';

  it('accepts thresholds and severities and nothing else', () => {
    const ok = parseAnomalyDetectorsOverlayFile(
      'x.yaml',
      `${header}detectors:\n  burst-write:\n    threshold: 2\n    severity: critical\n`,
    );
    expect(ok.ok).toBe(true);
  });

  it.each([
    ['enabled: false', 'detectors:\n  burst-write:\n    enabled: false\n'],
    ['a window change', 'detectors:\n  burst-write:\n    window: 24h\n'],
    ['an action', 'detectors:\n  burst-write:\n    action: kill\n'],
    ['an unreviewed detector id', 'detectors:\n  make-up-a-detector:\n    threshold: 1\n'],
    ['a negative threshold', 'detectors:\n  burst-write:\n    threshold: -1\n'],
    ['a severity outside the closed set', 'detectors:\n  burst-write:\n    severity: nuclear\n'],
  ])('refuses %s', (_label, body) => {
    const result = parseAnomalyDetectorsOverlayFile('x.yaml', `${header}${body}`);
    expect(result.ok).toBe(false);
  });

  it('refuses the wrong kind and apiVersion, and reports rather than throwing', () => {
    expect(
      parseAnomalyDetectorsOverlayFile('x.yaml', 'apiVersion: v2\nkind: AnomalyDetectors\n').ok,
    ).toBe(false);
    expect(
      parseAnomalyDetectorsOverlayFile('x.yaml', 'apiVersion: mcpforge/v1\nkind: Caps\n').ok,
    ).toBe(false);
    expect(parseAnomalyDetectorsOverlayFile('x.yaml', ':\n  - [').ok).toBe(false);
  });

  it('an absent overlay file tightens nothing and is not an error', () => {
    const loaded = loadEffectiveDetectorConfig(join(dir, 'does-not-exist.yaml'));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.config['burst-write'].threshold).toBe(
        DETECTOR_DEFAULTS['burst-write'].threshold,
      );
    }
  });

  it('a real overlay file on disk tightens exactly as declared and clamps the rest', () => {
    const path = join(dir, 'anomaly-detectors.yaml');
    writeFileSync(
      path,
      `${header}detectors:\n  burst-write:\n    threshold: 1\n    severity: critical\n  scope-probing:\n    threshold: 100000\n`,
      'utf-8',
    );
    const loaded = loadEffectiveDetectorConfig(path);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.config['burst-write']).toMatchObject({ threshold: 1, severity: 'critical' });
      expect(loaded.config['scope-probing'].threshold).toBe(
        DETECTOR_DEFAULTS['scope-probing'].threshold,
      );
    }
  });
});
