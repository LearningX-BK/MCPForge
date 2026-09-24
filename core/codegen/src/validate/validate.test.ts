import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRepo } from './engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

describe('validateRepo — passing manifests', () => {
  it('exits ok with zero failures for the valid fixture set', () => {
    const report = validateRepo(join(fixtures, 'valid'));
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.filesChecked).toBeGreaterThan(0);
  });
});

describe('validateRepo — structural failures name rule id, file, path and fix', () => {
  it('a bad id pattern fails with structural.pattern', () => {
    const report = validateRepo(join(fixtures, 'broken', 'bad-id'));
    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.ruleId === 'structural.pattern');
    expect(failure).toBeDefined();
    expect(failure!.file).toContain('voucher.create.tool.yaml');
    expect(failure!.path).toBe('/id');
    expect(failure!.fix.length).toBeGreaterThan(0);
    expect(failure!.message.length).toBeGreaterThan(0);
  });

  it('a missing required field fails with structural.required-field', () => {
    const report = validateRepo(join(fixtures, 'broken', 'missing-field'));
    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.ruleId === 'structural.required-field');
    expect(failure).toBeDefined();
    expect(failure!.file).toContain('voucher.create.tool.yaml');
    expect(failure!.message).toMatch(/purpose/);
    expect(failure!.fix.length).toBeGreaterThan(0);
  });
});

describe('validateRepo — referential integrity', () => {
  it('a Tool referencing a non-existent server fails with ref.server-not-found', () => {
    const report = validateRepo(join(fixtures, 'broken', 'bad-server'));
    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.ruleId === 'ref.server-not-found');
    expect(failure).toBeDefined();
    expect(failure!.path).toBe('/server');
    expect(failure!.message).toContain('jde-fin-ap-does-not-exist');
    expect(failure!.fix.length).toBeGreaterThan(0);
  });

  it('a Tool referencing a non-existent enumRef fails with ref.enum-not-found', () => {
    const report = validateRepo(join(fixtures, 'broken', 'bad-enum'));
    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.ruleId === 'ref.enum-not-found');
    expect(failure).toBeDefined();
    expect(failure!.path).toBe('/input/3/enumRef');
    expect(failure!.message).toContain('not_a_real_enum');
    expect(failure!.fix.length).toBeGreaterThan(0);
  });

  it('a valid tool set with a real server and real enumRef passes both referential checks', () => {
    const report = validateRepo(join(fixtures, 'valid'));
    expect(report.failures.some((f) => f.ruleId === 'ref.server-not-found')).toBe(false);
    expect(report.failures.some((f) => f.ruleId === 'ref.enum-not-found')).toBe(false);
  });

  it('a Package referencing a non-existent role fails with ref.package-role-not-found', () => {
    const report = validateRepo(join(fixtures, 'broken', 'bad-package-role'));
    expect(report.ok).toBe(false);
    const failure = report.failures.find((f) => f.ruleId === 'ref.package-role-not-found');
    expect(failure).toBeDefined();
    expect(failure!.path).toBe('/roles/0');
  });

  it('detects a duplicate id within the same kind', () => {
    const report = validateRepo(join(fixtures, 'broken', 'duplicate-id'));
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.ruleId === 'ref.duplicate-id')).toBe(true);
  });
});

// A Role manifest is authored AHEAD of the Tool manifests it names — Track I
// scaffolds servers/roles/packages (W0-I1) before the tools that fill them in
// (W0-I3/I4/I5). A named, human-approved exception recorded during W0-I1
// downgrades exactly two rules to `severity: warning`. This block is the
// regression guard on both halves of that: the two rules warn, and NOTHING
// ELSE does.
describe('validateRepo — Role manifests authored ahead of their tools (warning, not failure)', () => {
  const report = validateRepo(join(fixtures, 'broken', 'bad-role-coretool'));

  it('ref.role-core-tool-not-found is reported as a warning and does not fail the build', () => {
    const w = report.warnings.find((f) => f.ruleId === 'ref.role-core-tool-not-found');
    expect(w).toBeDefined();
    expect(w!.severity).toBe('warning');
    expect(w!.path).toBe('/coreTools/0');
    expect(w!.fix.length).toBeGreaterThan(0);
    expect(report.failures.some((f) => f.ruleId === 'ref.role-core-tool-not-found')).toBe(false);
  });

  it('ref.role-sod-tool-not-found is reported as a warning and does not fail the build', () => {
    const sod = report.warnings.filter((f) => f.ruleId === 'ref.role-sod-tool-not-found');
    expect(sod).toHaveLength(2);
    for (const w of sod) {
      expect(w.severity).toBe('warning');
      expect(w.fix.length).toBeGreaterThan(0);
    }
    expect(report.failures.some((f) => f.ruleId === 'ref.role-sod-tool-not-found')).toBe(false);
  });

  it('exits ok when those two rules are the only findings', () => {
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('the warnings stay in the report object, so `--json` still surfaces them in CI', () => {
    const json = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(json.warnings.map((w) => w.ruleId)).toContain('ref.role-core-tool-not-found');
    expect(json.warnings.map((w) => w.ruleId)).toContain('ref.role-sod-tool-not-found');
  });

  it('EVERY OTHER referential rule still hard-fails — the downgrade is not general', () => {
    const stillErrors: ReadonlyArray<readonly [string, string]> = [
      ['bad-server', 'ref.server-not-found'],
      ['bad-enum', 'ref.enum-not-found'],
      ['bad-package-role', 'ref.package-role-not-found'],
      ['duplicate-id', 'ref.duplicate-id'],
    ];
    for (const [fixture, ruleId] of stillErrors) {
      const r = validateRepo(join(fixtures, 'broken', fixture));
      expect(r.ok).toBe(false);
      const f = r.failures.find((x) => x.ruleId === ruleId);
      expect(f, `${ruleId} must remain a build failure`).toBeDefined();
      expect(f!.severity).not.toBe('warning');
      expect(r.warnings.some((x) => x.ruleId === ruleId)).toBe(false);
    }
  });

  it('only the two named rule ids may ever carry warning severity in the referential pass', () => {
    const allowed = new Set(['ref.role-core-tool-not-found', 'ref.role-sod-tool-not-found']);
    for (const fixture of [
      'bad-id',
      'missing-field',
      'bad-server',
      'bad-enum',
      'bad-package-role',
      'bad-role-coretool',
      'duplicate-id',
    ]) {
      const r = validateRepo(join(fixtures, 'broken', fixture));
      for (const w of r.warnings) {
        if (w.ruleId.startsWith('ref.')) {
          expect(allowed.has(w.ruleId), `${w.ruleId} unexpectedly downgraded to warning`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe('validateRepo — every failure carries the full quartet', () => {
  it('rule id, file, path and fix are all non-empty for every failure across every fixture', () => {
    for (const set of ['bad-id', 'missing-field', 'bad-server', 'bad-enum']) {
      const report = validateRepo(join(fixtures, 'broken', set));
      for (const f of report.failures) {
        expect(f.ruleId.length).toBeGreaterThan(0);
        expect(f.file.length).toBeGreaterThan(0);
        expect(f.path.length).toBeGreaterThan(0);
        expect(f.fix.length).toBeGreaterThan(0);
      }
    }
  });
});
