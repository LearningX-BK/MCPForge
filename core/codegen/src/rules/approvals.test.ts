// MCPForge — W0-P22: `policy.approval-not-self-approved`.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateRepo } from '../validate/engine.js';
import type { RepoContext, ValidationFailure } from '../validate/types.js';
import {
  APPROVAL_NOT_SELF_APPROVED,
  APPROVAL_RULES,
  GRANDFATHERED_APPROVAL_IDS,
  loadSuperAdminSubjects,
} from './approvals.js';
import { POLICY_RULES } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const realRepoRoot = resolve(here, '..', '..', '..', '..');

const BOSS = 'local:0192f000-0000-7000-8000-00000000b055';
const ALICE = 'local:0192f000-0000-7000-8000-0000000a11ce';
const BOB = 'local:0192f000-0000-7000-8000-000000000b0b';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcpforge-approvals-'));
  writeMapping([BOSS]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMapping(superAdminSubjects: readonly string[] | undefined): void {
  const dir = join(root, 'overlays', 'local', 'mappings');
  mkdirSync(dir, { recursive: true });
  const lines = [
    'apiVersion: mcpforge/v1',
    'kind: GroupRoleMapping',
    'deployment: local',
    'groups:',
    '  mcpforge-superadmins:',
    '    roles: [super-admin]',
    'superAdmins: [mcpforge-superadmins]',
  ];
  if (superAdminSubjects !== undefined) {
    lines.push(
      `superAdminSubjects: [${superAdminSubjects.map((s) => JSON.stringify(s)).join(', ')}]`,
    );
  }
  writeFileSync(join(dir, 'groups-to-roles.yaml'), `${lines.join('\n')}\n`, 'utf8');
}

function writeRecord(name: string, fields: Record<string, string | boolean>): void {
  const dir = join(root, 'approvals');
  mkdirSync(dir, { recursive: true });
  const body = [
    'apiVersion: mcpforge/v1',
    'kind: Approval',
    `id: ${name}`,
    'decision: approved',
    ...Object.entries(fields).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`,
    ),
  ].join('\n');
  writeFileSync(join(dir, `${name}.yaml`), `${body}\n`, 'utf8');
}

function run(): readonly ValidationFailure[] {
  const ctx: RepoContext = { repoRoot: root, files: [], manifests: [], enumNames: new Set() };
  return APPROVAL_RULES.flatMap((rule) => rule.check(ctx));
}

const errors = (fs: readonly ValidationFailure[]) => fs.filter((f) => f.severity !== 'warning');
const warnings = (fs: readonly ValidationFailure[]) => fs.filter((f) => f.severity === 'warning');

function expectActionable(f: ValidationFailure): void {
  expect(f.ruleId).toBe(APPROVAL_NOT_SELF_APPROVED);
  expect(f.file.startsWith('approvals/')).toBe(true);
  expect(f.fix.length).toBeGreaterThan(0);
  expect(f.fix).not.toMatch(/try again/i);
}

describe(`${APPROVAL_NOT_SELF_APPROVED} (W0-P22)`, () => {
  it('runs by default in forge validate', () => {
    expect(POLICY_RULES.map((r) => r.id)).toContain(APPROVAL_NOT_SELF_APPROVED);
  });

  it('passes a record approved by someone other than its requester', () => {
    writeRecord('2026-10-02-ok', { requestedBy: ALICE, approver: BOB });
    expect(run()).toEqual([]);
  });

  it('ignores a record with no approver (a request, not an approval)', () => {
    writeRecord('2026-10-02-pending', { requestedBy: ALICE });
    expect(run()).toEqual([]);
  });

  it('FAILS a record whose approver equals its requestedBy, without the flag', () => {
    writeRecord('2026-10-02-self', { requestedBy: ALICE, approver: ALICE });
    const out = run();
    expect(errors(out)).toHaveLength(1);
    expect(errors(out)[0]!.path).toBe('/selfApproved');
    expect(errors(out)[0]!.message).toMatch(/own requester/);
    expectActionable(errors(out)[0]!);
  });

  it('FAILS a non-super-admin self-approval even when it carries selfApproved: true', () => {
    writeRecord('2026-10-02-self-flag', {
      requestedBy: ALICE,
      approver: ALICE,
      selfApproved: true,
    });
    const out = run();
    expect(errors(out)).toHaveLength(1);
    expect(errors(out)[0]!.message).toMatch(/not listed in any superAdminSubjects/);
    expectActionable(errors(out)[0]!);
  });

  it('WARNS, naming the super admin, on a flagged self-approval by a listed super admin', () => {
    writeRecord('2026-10-02-boss-self', { requestedBy: BOSS, approver: BOSS, selfApproved: true });
    const out = run();
    expect(errors(out)).toEqual([]);
    expect(warnings(out)).toHaveLength(1);
    expect(warnings(out)[0]!.message).toContain(BOSS);
    expect(warnings(out)[0]!.message).toMatch(/SELF-APPROVED by super admin/);
  });

  it('FAILS a super admin self-approval that does not carry the flag', () => {
    writeRecord('2026-10-02-boss-silent', { requestedBy: BOSS, approver: BOSS });
    expect(errors(run())).toHaveLength(1);
  });

  it('FAILS the same super admin self-approval once their subject leaves superAdminSubjects', () => {
    writeMapping(undefined);
    writeRecord('2026-10-02-boss-self', { requestedBy: BOSS, approver: BOSS, selfApproved: true });
    expect(errors(run())).toHaveLength(1);
  });

  it('FAILS selfApproved: true on a record whose approver is not its requester', () => {
    writeRecord('2026-10-02-contradiction', {
      requestedBy: ALICE,
      approver: BOSS,
      selfApproved: true,
    });
    const out = errors(run());
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toMatch(/contradicts itself/);
  });

  it('FAILS a new record whose approver is a display label, not a Principal.subject', () => {
    writeRecord('2026-10-02-label', { requestedBy: ALICE, approver: 'Admin' });
    const out = errors(run());
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/approver');
    expectActionable(out[0]!);
  });

  it('FAILS a new record whose requestedBy is an email, so one person cannot self-approve under two spellings', () => {
    writeRecord('2026-10-02-email', { requestedBy: 'alice@example.com', approver: ALICE });
    const out = errors(run());
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe('/requestedBy');
  });

  it('grandfathers a pre-rule record BY ID as a warning, whatever it says', () => {
    writeRecord('2026-09-15-p2p-function-grant', {
      requestedBy: 'pattnaikbikash@gmail.com',
      approver: 'Admin',
    });
    const out = run();
    expect(errors(out)).toEqual([]);
    expect(warnings(out)).toHaveLength(1);
    expect(warnings(out)[0]!.message).toMatch(/grandfathered/);
  });

  it('does NOT grandfather a new record that is merely backdated', () => {
    writeRecord('2026-09-14-backdated', {
      requestedBy: 'pattnaikbikash@gmail.com',
      approver: 'Admin',
      approvedAt: '2026-09-14',
    });
    expect(errors(run())).toHaveLength(1);
  });

  it('reads superAdminSubjects from every overlay mapping, and nothing else', () => {
    expect([...loadSuperAdminSubjects(root)]).toEqual([BOSS]);
    mkdirSync(join(root, 'overlays', 'local', 'other'), { recursive: true });
    writeFileSync(
      join(root, 'overlays', 'local', 'other', 'x.yaml'),
      'kind: GroupRoleMapping\nsuperAdminSubjects: [local:not-a-mapping-dir]\n',
      'utf8',
    );
    expect([...loadSuperAdminSubjects(root)]).toEqual([BOSS]);
  });
});

describe(`${APPROVAL_NOT_SELF_APPROVED} on the real repository`, () => {
  it('the grandfather list is exactly the records committed when the rule landed, and each is a warning', () => {
    const committed = readdirSync(join(realRepoRoot, 'approvals'))
      .filter((n) => n.endsWith('.yaml'))
      .map((n) => n.replace(/\.yaml$/, ''));
    for (const id of GRANDFATHERED_APPROVAL_IDS) expect(committed).toContain(id);
    expect(GRANDFATHERED_APPROVAL_IDS.size).toBe(17);

    const report = validateRepo(realRepoRoot);
    expect(report.failures.filter((f) => f.ruleId === APPROVAL_NOT_SELF_APPROVED)).toEqual([]);
    const ours = report.warnings.filter((f) => f.ruleId === APPROVAL_NOT_SELF_APPROVED);
    expect(ours.length).toBeGreaterThanOrEqual(GRANDFATHERED_APPROVAL_IDS.size);
  });
});
