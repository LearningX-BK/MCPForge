// MCPForge — W0-B8 done-criterion tests: role/package/consumer compilation
// and segregation-of-duties detection. 02 §4.3, §6.1, §11.2, §11.4.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCodegen } from '../emit/pipeline.js';
import { validateRepo } from '../validate/engine.js';
import type { ValidationFailure } from '../validate/types.js';
import { grantIsExpired, matchesToolIdGlob, resolveGlobs } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = join(here, 'fixtures', 'base');

const VOUCHER_CREATE = 'jde.ap.voucher.create';
const PO_CREATE = 'jde.scm.purchase_order.create';
const PO_APPROVE = 'jde.scm.purchase_order.approve';

/** A throwaway copy of the base fixture repo, so a test may edit its manifests. */
function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-b8-'));
  cpSync(BASE, dir, { recursive: true });
  return dir;
}

function roleFile(repoRoot: string): string {
  return join(repoRoot, 'roles', 'p2p.yaml');
}

function readJson(absPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(absPath, 'utf8')) as Record<string, unknown>;
}

function scopePath(repoRoot: string, roleId = 'p2p'): string {
  return join(repoRoot, 'generated', 'roles', `${roleId}.scope.json`);
}

function byRule(list: readonly ValidationFailure[], ruleId: string): ValidationFailure[] {
  return list.filter((f) => f.ruleId === ruleId);
}

// ---------------------------------------------------------------------------
// The glob engine
// ---------------------------------------------------------------------------

describe('tool-id glob matching', () => {
  it('matches segment-wise and never lets * cross a dot', () => {
    expect(matchesToolIdGlob(VOUCHER_CREATE, 'jde.ap.voucher.*')).toBe(true);
    expect(matchesToolIdGlob(VOUCHER_CREATE, 'jde.ap.voucher.create')).toBe(true);
    expect(matchesToolIdGlob(VOUCHER_CREATE, 'jde.ap.*.create')).toBe(true);
    // The escalation this guards: a trailing * must not swallow further segments.
    expect(matchesToolIdGlob('jde.ap.voucher_shadow.approve', 'jde.ap.voucher.*')).toBe(false);
    expect(matchesToolIdGlob('jde.ap.voucher.create.extra', 'jde.ap.voucher.*')).toBe(false);
    expect(matchesToolIdGlob(VOUCHER_CREATE, 'jde.ap.**')).toBe(true);
  });

  it('excludes win over includes, and the result is sorted and de-duplicated', () => {
    const ids = ['jde.ap.voucher.get', VOUCHER_CREATE, 'jde.ap.voucher.cancel'];
    expect(resolveGlobs(ids, ['jde.ap.voucher.*'], ['jde.ap.voucher.cancel'])).toEqual([
      'jde.ap.voucher.create',
      'jde.ap.voucher.get',
    ]);
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 1 — globs compile to an explicit sorted id list
// ---------------------------------------------------------------------------

describe('W0-B8 DONE: roles/p2p.yaml globs compile to generated/roles/p2p.scope.json', () => {
  it('is an explicit, sorted tool-id list, not the glob patterns', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const scope = readJson(scopePath(repoRoot));
      expect(scope['roleId']).toBe('p2p');
      const toolIds = scope['toolIds'] as string[];
      expect(toolIds).toEqual([
        'jde.ap.voucher.cancel',
        'jde.ap.voucher.create',
        'jde.ap.voucher.get',
        PO_APPROVE,
        PO_CREATE,
      ]);
      expect([...toolIds].sort()).toEqual(toolIds);
      // The compiled list is explicit ids; the globs are recorded beside it
      // for review, never in place of it.
      expect(toolIds.every((id) => !id.includes('*'))).toBe(true);
      expect(scope['includes']).toEqual(['jde.scm.purchase_order.*', 'jde.ap.voucher.*']);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 2 — adding a matching tool produces a VISIBLE DIFF
// ---------------------------------------------------------------------------

describe('W0-B8 DONE: adding a tool matching an existing glob is a visible diff', () => {
  it('the new id appears, in sorted position, and the file bytes change', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const before = readFileSync(scopePath(repoRoot), 'utf8');
      expect(before).not.toContain('jde.ap.voucher.search');

      // A new tool the role's EXISTING glob already admits — nobody edited
      // roles/p2p.yaml, which is exactly the silent-widening case 02 §4.3
      // says must be impossible to miss.
      const src = readFileSync(
        join(repoRoot, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'),
        'utf8',
      );
      writeFileSync(
        join(repoRoot, 'manifests', 'jde', 'fin', 'ap', 'voucher.search.tool.yaml'),
        src
          .replace('id: jde.ap.voucher.get', 'id: jde.ap.voucher.search')
          .replace(/^verb: get$/m, 'verb: search'),
        'utf8',
      );

      await runCodegen(repoRoot);
      const after = readFileSync(scopePath(repoRoot), 'utf8');
      expect(after).not.toBe(before);
      const toolIds = readJson(scopePath(repoRoot))['toolIds'] as string[];
      expect(toolIds).toContain('jde.ap.voucher.search');
      expect(toolIds.indexOf('jde.ap.voucher.search')).toBe(
        toolIds.indexOf('jde.ap.voucher.get') + 1,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 3 — SoD: declared conflicts and the implicit create/approve
// ---------------------------------------------------------------------------

describe('W0-B8 DONE: forge validate flags declared SoD conflicts', () => {
  it('a declared conflict realised in the compiled scope is reported', () => {
    const repoRoot = freshRepo();
    try {
      const report = validateRepo(repoRoot);
      const declared = byRule(report.warnings, 'sod.declared-conflict');
      expect(declared).toHaveLength(1);
      expect(declared[0]!.message).toContain(PO_CREATE);
      expect(declared[0]!.message).toContain(PO_APPROVE);
      expect(declared[0]!.file).toBe('roles/p2p.yaml');
      // disposition: warn-and-require-exception -> warning, not a failure.
      expect(byRule(report.failures, 'sod.declared-conflict')).toHaveLength(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('disposition: block FAILS the build', () => {
    const repoRoot = freshRepo();
    try {
      const yaml = readFileSync(roleFile(repoRoot), 'utf8').replace(
        'disposition: warn-and-require-exception',
        'disposition: block',
      );
      writeFileSync(roleFile(repoRoot), yaml, 'utf8');

      const report = validateRepo(repoRoot);
      const blocked = byRule(report.failures, 'sod.declared-conflict');
      expect(blocked).toHaveLength(1);
      expect(blocked[0]!.severity).toBe('error');
      expect(report.ok).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('a declared conflict the role does not actually grant is NOT reported', () => {
    const repoRoot = freshRepo();
    try {
      // Exclude one half of the pair: the conflict can no longer be realised.
      const yaml = readFileSync(roleFile(repoRoot), 'utf8')
        .replace('disposition: warn-and-require-exception', 'disposition: block')
        .replace('excludes: []', `excludes:\n  - ${PO_APPROVE}`);
      writeFileSync(roleFile(repoRoot), yaml, 'utf8');

      const report = validateRepo(repoRoot);
      expect(byRule(report.failures, 'sod.declared-conflict')).toHaveLength(0);
      expect(byRule(report.warnings, 'sod.implicit-create-approve')).toHaveLength(0);
      expect(report.ok).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('W0-B8 DONE: forge validate flags the implicit create/approve pattern', () => {
  it('reports create+approve on one {app}.{module}.{entity}, even when also declared', () => {
    const repoRoot = freshRepo();
    try {
      const report = validateRepo(repoRoot);
      const implicit = byRule(report.warnings, 'sod.implicit-create-approve');
      expect(implicit).toHaveLength(1);
      expect(implicit[0]!.message).toContain('jde.scm.purchase_order');
      expect(implicit[0]!.severity).toBe('warning');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reports the pattern when NOBODY declared it, and says so', () => {
    const repoRoot = freshRepo();
    try {
      const yaml = readFileSync(roleFile(repoRoot), 'utf8').replace(
        /segregationOfDuties:\n(?: {2}- conflict:[^\n]*\n {4}disposition:[^\n]*\n)/,
        'segregationOfDuties: []\n',
      );
      writeFileSync(roleFile(repoRoot), yaml, 'utf8');

      const report = validateRepo(repoRoot);
      const implicit = byRule(report.warnings, 'sod.implicit-create-approve');
      expect(implicit).toHaveLength(1);
      expect(implicit[0]!.message).toContain('NOT declared');
      // Undeclared has no disposition, so it cannot fail the build on its own.
      expect(byRule(report.failures, 'sod.implicit-create-approve')).toHaveLength(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 4 [P5] — bindingGrants in the role scope; widening is a diff
// ---------------------------------------------------------------------------

describe('W0-B8 DONE [P5]: bindingGrants compile into the role scope artefact', () => {
  it('appear alongside the tool-id list, with an explicit expired flag', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const scope = readJson(scopePath(repoRoot));
      const grants = scope['bindingGrants'] as Record<string, unknown>[];
      expect(grants).toHaveLength(2);
      const plsql = grants.find((g) => g['bindingType'] === 'plsql')!;
      expect(plsql['names']).toEqual(['MCPFORGE_WRAP.AP_VOUCHER']);
      expect(plsql['approvalRef']).toBe('appr-2026-08-27-p2p-plsql');
      expect(plsql['expired']).toBe(false);
      // The grant sits in the SAME file as the tool-id list it does not imply.
      expect(scope['toolIds']).toBeDefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('widening a grant produces a visible diff', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const before = readFileSync(scopePath(repoRoot), 'utf8');

      const yaml = readFileSync(roleFile(repoRoot), 'utf8').replace(
        'names: [MCPFORGE_WRAP.AP_VOUCHER]',
        'names: [MCPFORGE_WRAP.AP_VOUCHER, MCPFORGE_WRAP.GL_JOURNAL]',
      );
      writeFileSync(roleFile(repoRoot), yaml, 'utf8');

      await runCodegen(repoRoot);
      const after = readFileSync(scopePath(repoRoot), 'utf8');
      expect(after).not.toBe(before);
      expect(after).toContain('MCPFORGE_WRAP.GL_JOURNAL');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('an expired grant compiles to expired: true rather than disappearing', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const grants = readJson(scopePath(repoRoot))['bindingGrants'] as Record<string, unknown>[];
      const stale = grants.find((g) => g['bindingType'] === 'function')!;
      expect(stale).toBeDefined();
      expect(stale['expiresAt']).toBe('2026-01-31');
      expect(stale['expired']).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('an absent or malformed expiresAt is treated as EXPIRED, never as live', () => {
    expect(grantIsExpired('', '2026-08-30')).toBe(true);
    expect(grantIsExpired('never', '2026-08-30')).toBe(true);
    expect(grantIsExpired('2026-08-30', '2026-08-30')).toBe(false);
    expect(grantIsExpired('2026-08-29', '2026-08-30')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 5 [P5] — consumer authorization artefacts
// ---------------------------------------------------------------------------

describe('W0-B8 DONE [P5]: each Consumer compiles to generated/consumers/<id>.authorization.json', () => {
  const consumerPath = (repoRoot: string): string =>
    join(repoRoot, 'generated', 'consumers', 'claude-desktop-coe.authorization.json');

  it('carries the authorizations, and no credential reference', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const doc = readJson(consumerPath(repoRoot));
      expect(doc['consumerId']).toBe('claude-desktop-coe');
      const auth = doc['authorizations'] as Record<string, unknown>;
      expect(auth['roles']).toEqual(['p2p']);
      expect(auth['bindingTypes']).toEqual(['rest', 'wrapped-vendor']);
      expect(auth['writeAllowed']).toBe(false);
      // CLAUDE.md #8 — nothing credential-shaped is echoed into the artefact.
      expect(JSON.stringify(doc)).not.toContain('secretRef://');
      expect(doc['credential']).toBeUndefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('widening a consumer authorization produces a visible diff', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const before = readFileSync(consumerPath(repoRoot), 'utf8');

      const file = join(repoRoot, 'consumers', 'claude-desktop-coe.consumer.yaml');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('writeAllowed: false', 'writeAllowed: true'),
        'utf8',
      );

      await runCodegen(repoRoot);
      const after = readFileSync(consumerPath(repoRoot), 'utf8');
      expect(after).not.toBe(before);
      expect(
        (readJson(consumerPath(repoRoot))['authorizations'] as Record<string, unknown>)[
          'writeAllowed'
        ],
      ).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("an expired consumer grant compiles to expired: true rather than disappearing", async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const grants = readJson(consumerPath(repoRoot))['bindingGrants'] as Record<
        string,
        unknown
      >[];
      expect(grants).toHaveLength(1);
      expect(grants[0]!['expiresAt']).toBe('2026-01-31');
      expect(grants[0]!['expired']).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Packages are selections (02 §6.1)
// ---------------------------------------------------------------------------

describe('W0-B8: a Package compiles to a selection, not a build', () => {
  it('unions its roles compiled scopes and copies its server list unchanged', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const doc = readJson(join(repoRoot, 'generated', 'packages', 'jde-fin.selection.json'));
      expect(doc['packageId']).toBe('jde-fin');
      expect(doc['servers']).toEqual(['jde-fin-ap', 'jde-scm-po']);
      expect(doc['roles']).toEqual(['p2p']);
      expect(doc['toolIds']).toEqual(
        readJson(scopePath(repoRoot))['toolIds'],
      );
      expect(doc['unresolvedRoles']).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The regeneration invariant, with compilation in the pipeline
// ---------------------------------------------------------------------------

describe('W0-B8: the regeneration invariant still holds', () => {
  const ARTEFACTS = [
    ['generated', 'roles', 'p2p.scope.json'],
    ['generated', 'packages', 'jde-fin.selection.json'],
    ['generated', 'consumers', 'claude-desktop-coe.authorization.json'],
  ];

  it('two runs are byte-identical, and so is a run after deleting generated/', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const first = ARTEFACTS.map((p) => readFileSync(join(repoRoot, ...p), 'utf8'));

      await runCodegen(repoRoot);
      expect(ARTEFACTS.map((p) => readFileSync(join(repoRoot, ...p), 'utf8'))).toEqual(first);

      rmSync(join(repoRoot, 'generated'), { recursive: true, force: true });
      await runCodegen(repoRoot);
      expect(ARTEFACTS.map((p) => readFileSync(join(repoRoot, ...p), 'utf8'))).toEqual(first);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
