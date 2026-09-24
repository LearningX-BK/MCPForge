// MCPForge — W0-N4: a `standingAuthorization` resolves to a committed approval
// record, and granting one is visible in the compiled scope diff.
// 02 §11.4.4 / 05 §3.3.4.
//
// The three properties this file owns:
//
//   1. RESOLUTION — the ref names a committed record in `approvals/`, and the
//      record's named approver and its own `expiresAt` are compiled into the
//      artefact rather than left behind a string.
//   2. FAIL-CLOSED — missing, unapproved, unnamed, undated or expired all
//      compile to `effective: false` with a status that says which. None of
//      them compiles to a usable standing authorization.
//   3. VISIBILITY — granting one changes the bytes of
//      `generated/roles/<id>.scope.json`, which is what makes it reviewable.
//
// Fixture paths are resolved from `import.meta.url`, never from
// `process.cwd()`, so the suite passes from any working directory.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runCodegen } from '../emit/pipeline.js';
import { loadApprovalRecords, resolveStandingAuthorization } from './standing.js';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = join(here, 'fixtures', 'base');
const APPROVAL_REF = 'appr-2026-08-27-p2p-plsql';

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-n4-'));
  cpSync(BASE, dir, { recursive: true });
  return dir;
}

function approvalPath(repoRoot: string): string {
  return join(repoRoot, 'approvals', `${APPROVAL_REF}.yaml`);
}

function scopePath(repoRoot: string): string {
  return join(repoRoot, 'generated', 'roles', 'p2p.scope.json');
}

/** The compiled `plsql` grant — the one the base fixture standing-authorizes. */
function compiledPlsqlGrant(repoRoot: string): Record<string, unknown> {
  const scope = JSON.parse(readFileSync(scopePath(repoRoot), 'utf8')) as Record<string, unknown>;
  const grants = scope['bindingGrants'] as Record<string, unknown>[];
  const grant = grants.find((g) => g['bindingType'] === 'plsql');
  expect(grant, 'the fixture role has a plsql bindingGrant').toBeDefined();
  return grant!;
}

function standingBlock(repoRoot: string): Record<string, unknown> {
  const block = compiledPlsqlGrant(repoRoot)['standingAuthorization'];
  expect(typeof block).toBe('object');
  return block as Record<string, unknown>;
}

/** Rewrite the committed approval record with the given fields. */
function writeApproval(repoRoot: string, fields: Record<string, string>): void {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n');
  writeFileSync(approvalPath(repoRoot), `${body}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// DONE CRITERION 1 — it resolves to a committed record with a named approver
//                    and an expiresAt
// ---------------------------------------------------------------------------

describe('W0-N4 DONE: a standingAuthorization resolves to a committed approval record', () => {
  it("compiles the record's named approver and its own expiry into the scope artefact", async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      expect(standingBlock(repoRoot)).toEqual({
        ref: APPROVAL_REF,
        status: 'active',
        // Straight off the committed record, not off the grant.
        approver: 'A. Named Approver',
        expiresAt: '2027-02-23',
        effective: true,
      });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("the compiled expiry is the RECORD's, so a record outliving its grant is still visible", () => {
    // The two expiries are independent: the grant's kills the grant, the
    // record's kills only the standing authorization.
    const records = loadApprovalRecords(BASE);
    expect(records.get(APPROVAL_REF)?.expiresAt).toBe('2027-02-23');
    expect(records.get(APPROVAL_REF)?.approver).toBe('A. Named Approver');
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 2 — fail closed on every way a record can be missing or wrong
// ---------------------------------------------------------------------------

describe('W0-N4 DONE: an unusable standing authorization compiles to effective: false', () => {
  it('a MISSING approval record compiles to status unresolved, never to a live one', async () => {
    const repoRoot = freshRepo();
    try {
      unlinkSync(approvalPath(repoRoot));
      await runCodegen(repoRoot);
      const block = standingBlock(repoRoot);
      expect(block['status']).toBe('unresolved');
      expect(block['effective']).toBe(false);
      expect(block['approver']).toBe('');
      // Emitted, not dropped: an absence and a disappearance look identical in
      // a diff, and only one of them is a governance event.
      expect(block['ref']).toBe(APPROVAL_REF);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('a record with NO NAMED APPROVER compiles to status no-approver', async () => {
    const repoRoot = freshRepo();
    try {
      writeApproval(repoRoot, {
        id: APPROVAL_REF,
        decision: 'approved',
        expiresAt: '2027-02-23',
      });
      await runCodegen(repoRoot);
      const block = standingBlock(repoRoot);
      expect(block['status']).toBe('no-approver');
      expect(block['effective']).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('a PENDING record is not an approval — status not-approved', async () => {
    const repoRoot = freshRepo();
    try {
      // Exactly the shape core/gateway/consumer/approval.ts writes for a
      // record whose approver has not yet completed it.
      writeApproval(repoRoot, {
        id: APPROVAL_REF,
        status: 'pending',
        approver: 'A. Named Approver',
        expiresAt: '2027-02-23',
      });
      await runCodegen(repoRoot);
      const block = standingBlock(repoRoot);
      expect(block['status']).toBe('not-approved');
      expect(block['effective']).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('a record with NO EXPIRY compiles to status no-expiry — a standing authorization that never ends is not one', async () => {
    const repoRoot = freshRepo();
    try {
      writeApproval(repoRoot, {
        id: APPROVAL_REF,
        decision: 'approved',
        approver: 'A. Named Approver',
      });
      await runCodegen(repoRoot);
      const block = standingBlock(repoRoot);
      expect(block['status']).toBe('no-expiry');
      expect(block['effective']).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('an EXPIRED record compiles to status expired — renewal is a fresh approval, not a rollover', () => {
    // Unit-level, because expiry is a function of the clock and the artefact
    // test would be pinned to a date that eventually passes.
    const records = new Map([
      [
        APPROVAL_REF,
        {
          ref: APPROVAL_REF,
          approver: 'A. Named Approver',
          expiresAt: '2026-01-31',
          decision: 'approved',
        },
      ],
    ]);
    expect(resolveStandingAuthorization(APPROVAL_REF, records, '2026-09-03')).toEqual({
      ref: APPROVAL_REF,
      status: 'expired',
      approver: 'A. Named Approver',
      expiresAt: '2026-01-31',
      effective: false,
    });
    // The day it expires it is still in force; the day after, it is not.
    expect(resolveStandingAuthorization(APPROVAL_REF, records, '2026-01-31').effective).toBe(true);
    expect(resolveStandingAuthorization(APPROVAL_REF, records, '2026-02-01').effective).toBe(false);
  });

  it('a malformed expiry is EXPIRED, not ignored', () => {
    const records = new Map([
      [
        APPROVAL_REF,
        { ref: APPROVAL_REF, approver: 'A', expiresAt: 'whenever', decision: 'approved' },
      ],
    ]);
    const resolved = resolveStandingAuthorization(APPROVAL_REF, records, '2026-09-03');
    expect(resolved.status).toBe('no-expiry');
    expect(resolved.effective).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DONE CRITERION 3 — granting one is VISIBLE in the compiled scope diff
// ---------------------------------------------------------------------------

describe('W0-N4 DONE: granting a standing authorization is visible in the compiled scope diff', () => {
  it('adding one to a grant that had none changes the artefact bytes, naming the approver and the expiry', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const before = readFileSync(scopePath(repoRoot), 'utf8');

      // The `function` grant in the base fixture carries no standing
      // authorization. Granting one is a one-line manifest edit — and the
      // point of 02 §11.4.4's second property is that a one-line edit that
      // stands down per-call approval cannot be a quiet one.
      const rolePath = join(repoRoot, 'roles', 'p2p.yaml');
      const role = readFileSync(rolePath, 'utf8');
      writeFileSync(
        rolePath,
        role.replace(
          '    expiresAt: "2026-01-31"',
          `    expiresAt: "2026-01-31"\n    standingAuthorization: ${APPROVAL_REF}`,
        ),
        'utf8',
      );
      await runCodegen(repoRoot);
      const after = readFileSync(scopePath(repoRoot), 'utf8');

      expect(after).not.toBe(before);
      const scope = JSON.parse(after) as Record<string, unknown>;
      const grants = scope['bindingGrants'] as Record<string, unknown>[];
      const fn = grants.find((g) => g['bindingType'] === 'function')!;
      const block = fn['standingAuthorization'] as Record<string, unknown>;
      // The reviewer sees WHO approved it and UNTIL WHEN, in the diff, without
      // opening another file.
      expect(block['approver']).toBe('A. Named Approver');
      expect(block['expiresAt']).toBe('2027-02-23');
      expect(after).toContain('A. Named Approver');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('REVOKING the approval record is equally visible — the status flips in the diff', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const before = readFileSync(scopePath(repoRoot), 'utf8');
      expect(before).toContain('"status": "active"');

      unlinkSync(approvalPath(repoRoot));
      await runCodegen(repoRoot);
      const after = readFileSync(scopePath(repoRoot), 'utf8');
      expect(after).not.toBe(before);
      expect(after).toContain('"status": "unresolved"');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('the regeneration invariant still holds — two runs are byte-identical', async () => {
    const repoRoot = freshRepo();
    try {
      await runCodegen(repoRoot);
      const first = readFileSync(scopePath(repoRoot), 'utf8');
      await runCodegen(repoRoot);
      expect(readFileSync(scopePath(repoRoot), 'utf8')).toBe(first);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
