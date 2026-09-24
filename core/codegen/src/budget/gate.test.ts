// MCPForge — W0-G5 done-criterion tests: the token-budget gate. 02 §5.3.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countTokens } from '@mcpforge/shared/tokens';
import { chooseDemotions, runTokenBudgetGate } from './gate.js';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = join(here, 'fixtures', 'base');

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-g5-'));
  cpSync(BASE, dir, { recursive: true });
  return dir;
}

const VOUCHER_CREATE_PATH = ['manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'];
const ROLE_PATH = ['roles', 'p2p.yaml'];

function readFile(repoRoot: string, parts: readonly string[]): string {
  return readFileSync(join(repoRoot, ...parts), 'utf8');
}

function writeFile(repoRoot: string, parts: readonly string[], content: string): void {
  writeFileSync(join(repoRoot, ...parts), content);
}

// ---------------------------------------------------------------------------
// The passing case
// ---------------------------------------------------------------------------

describe('runTokenBudgetGate — passing case (the base fixture, unmodified)', () => {
  it('finds every tool card, resident definition and describe response within budget, and the p2p core set within 1,300', () => {
    const repoRoot = freshRepo();
    const result = runTokenBudgetGate(repoRoot);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.toolsChecked).toBeGreaterThanOrEqual(5);
    expect(result.rolesChecked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Failing case 1 — the card budget (≤60), unchanged, still enforced by this gate
// ---------------------------------------------------------------------------

describe('runTokenBudgetGate — card budget failure', () => {
  it('fails a tool whose purpose blows the 60-token card budget, and does not blame the (unrelated) access field', () => {
    const repoRoot = freshRepo();
    const original = readFile(repoRoot, VOUCHER_CREATE_PATH);
    const bloatedPurpose =
      'purpose: Create an AP voucher against a supplier, optionally matched to a purchase order, following the standard three-way-match accounts payable process end to end from intake through GL posting and eventual payment settlement.';
    const edited = original.replace(
      /purpose: Create an AP voucher against a supplier, optionally matched to a PO\./,
      bloatedPurpose,
    );
    expect(edited).not.toBe(original);
    writeFile(repoRoot, VOUCHER_CREATE_PATH, edited);

    const result = runTokenBudgetGate(repoRoot);
    expect(result.ok).toBe(false);
    const failure = result.failures.find(
      (f) => f.kind === 'card' && f.id === 'jde.ap.voucher.create',
    );
    expect(failure).toBeDefined();
    expect(failure!.limit).toBe(60);
    expect(failure!.counted).toBeGreaterThan(60);
    expect(failure!.message).toContain('§5.3(a)');
    // The card wire shape never carries an `access` field (that lives on the
    // find RESPONSE, not the card artefact — access.ts's documented
    // boundary) — so nothing about this failure's cause is the access field.
    expect(failure!.message).not.toContain('access');
  });
});

// ---------------------------------------------------------------------------
// Failing case 2 — the resident-definition hard cap (≤400)
// ---------------------------------------------------------------------------

describe('runTokenBudgetGate — resident-definition budget failure', () => {
  it('fails a tool whose input schema blows the 400-token hard cap', () => {
    const repoRoot = freshRepo();
    const original = readFile(repoRoot, VOUCHER_CREATE_PATH);
    const extraInputs = Array.from({ length: 22 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return `  - { name: extra_field_${n}, type: string, required: false, desc: "An additional free-text field number ${n} carrying supplementary context for this line." }`;
    }).join('\n');
    const edited = original.replace(
      /input:\n/,
      `input:\n${extraInputs}\n`,
    );
    expect(edited).not.toBe(original);
    writeFile(repoRoot, VOUCHER_CREATE_PATH, edited);

    const result = runTokenBudgetGate(repoRoot);
    expect(result.ok).toBe(false);
    const failure = result.failures.find(
      (f) => f.kind === 'resident' && f.id === 'jde.ap.voucher.create',
    );
    expect(failure).toBeDefined();
    expect(failure!.limit).toBe(400);
    expect(failure!.counted).toBeGreaterThan(400);
    expect(failure!.message).toContain('§5.3(b)');
  });
});

// ---------------------------------------------------------------------------
// Failing case 3 — the describe budget (≤600), tripped independently of the
// resident-definition cap: the extra weight lives in writeSafety, which the
// resident definition never carries at all (02 §5.3(b) forbids it there).
// ---------------------------------------------------------------------------

describe('runTokenBudgetGate — describe budget failure', () => {
  it('fails a tool whose write-safety block blows the 600-token describe budget while its resident definition stays under 400', () => {
    const repoRoot = freshRepo();
    const original = readFile(repoRoot, VOUCHER_CREATE_PATH);
    const longMessage =
      'This guardrail exists because the MCPForge governance board capped single-voucher exposure at this ceiling pending a broader delegation-of-authority review across every JD Edwards company code in this deployment, and breaching it requires a named compensating approval.';
    const extraGuardrails = Array.from({ length: 6 }, (_, i) => {
      return `    - { kind: maxNumeric, field: amount, value: ${250000 - i}, message: "${longMessage} (variant ${i})" }`;
    }).join('\n');
    const edited = original.replace(
      /guardrails:\n {4}- \{ kind: maxNumeric, field: amount, value: 250000, message: Voucher amount exceeds the MCPForge ceiling for this tool\. \}\n/,
      `guardrails:\n${extraGuardrails}\n`,
    );
    expect(edited).not.toBe(original);
    writeFile(repoRoot, VOUCHER_CREATE_PATH, edited);

    const result = runTokenBudgetGate(repoRoot);
    expect(result.ok).toBe(false);
    const residentFailure = result.failures.find(
      (f) => f.kind === 'resident' && f.id === 'jde.ap.voucher.create',
    );
    expect(residentFailure).toBeUndefined();
    const describeFailure = result.failures.find(
      (f) => f.kind === 'describe' && f.id === 'jde.ap.voucher.create',
    );
    expect(describeFailure).toBeDefined();
    expect(describeFailure!.limit).toBe(600);
    expect(describeFailure!.counted).toBeGreaterThan(600);
    expect(describeFailure!.message).toContain('§5.3(c)');
  });
});

// ---------------------------------------------------------------------------
// Failing case 4 — the role core-set budget (≤1,300), naming the specific
// tools to demote.
// ---------------------------------------------------------------------------

describe('runTokenBudgetGate — role core-set budget failure', () => {
  it('fails a role whose coreTools sum exceeds 1,300 tokens and names the most expensive tools to demote', () => {
    const repoRoot = freshRepo();
    const role = readFile(repoRoot, ROLE_PATH);
    const edited = role.replace(
      /coreTools:\n {2}- jde\.scm\.purchase_order\.create\n {2}- jde\.scm\.purchase_order\.approve\n {2}- jde\.ap\.voucher\.create\n/,
      'coreTools:\n  - jde.scm.purchase_order.create\n  - jde.scm.purchase_order.approve\n  - jde.ap.voucher.create\n  - jde.ap.voucher.get\n  - jde.ap.voucher.cancel\n',
    );
    expect(edited).not.toBe(role);
    writeFile(repoRoot, ROLE_PATH, edited);

    // Also bloat every tool's resident definition so 5 tools clears 1,300 —
    // the base fixture's 5 tools alone (~150-200 tokens each) may not.
    for (const toolFile of [
      ['manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'],
      ['manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'],
      ['manifests', 'jde', 'fin', 'ap', 'voucher.cancel.tool.yaml'],
      ['manifests', 'jde', 'scm', 'po', 'purchase_order.create.tool.yaml'],
      ['manifests', 'jde', 'scm', 'po', 'purchase_order.approve.tool.yaml'],
    ]) {
      const original = readFile(repoRoot, toolFile);
      const extraInputs = Array.from({ length: 10 }, (_, i) => {
        const n = String(i).padStart(2, '0');
        return `  - { name: pad_field_${n}, type: string, required: false, desc: "A padding field number ${n} used only to raise this fixture's token count." }`;
      }).join('\n');
      const edited2 = original.includes('input:\n')
        ? original.replace(/input:\n/, `input:\n${extraInputs}\n`)
        : original;
      writeFile(repoRoot, toolFile, edited2);
    }

    const result = runTokenBudgetGate(repoRoot);
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.kind === 'roleCoreSet' && f.id === 'p2p');
    expect(failure).toBeDefined();
    expect(failure!.limit).toBe(1300);
    expect(failure!.counted).toBeGreaterThan(1300);
    expect(failure!.demote).toBeDefined();
    expect(failure!.demote!.length).toBeGreaterThan(0);
    // Every named demotion must actually be one of the role's core tools.
    for (const id of failure!.demote!) {
      expect([
        'jde.scm.purchase_order.create',
        'jde.scm.purchase_order.approve',
        'jde.ap.voucher.create',
        'jde.ap.voucher.get',
        'jde.ap.voucher.cancel',
      ]).toContain(id);
    }
    expect(failure!.message).toContain('§5.3(d)');
    expect(failure!.message).toContain('Demote from coreTools');
  });
});

// ---------------------------------------------------------------------------
// chooseDemotions — the demotion-ordering policy in isolation
// ---------------------------------------------------------------------------

describe('chooseDemotions', () => {
  it('demotes the most expensive tools first, the minimum number needed to clear the budget', () => {
    const coreTools = [
      { id: 'a', tokens: 100 },
      { id: 'b', tokens: 900 },
      { id: 'c', tokens: 200 },
      { id: 'd', tokens: 300 },
    ]; // sum 1500, limit 1300 -> demoting just 'b' (900) alone is not enough
    // (1500-900=600, already within 1300) so exactly one demotion suffices.
    const { demote, remainingTokens } = chooseDemotions(coreTools, 1300);
    expect(demote).toEqual(['b']);
    expect(remainingTokens).toBe(600);
    expect(remainingTokens).toBeLessThanOrEqual(1300);
  });

  it('demotes nothing when already within budget', () => {
    const coreTools = [{ id: 'a', tokens: 100 }];
    const { demote, remainingTokens } = chooseDemotions(coreTools, 1300);
    expect(demote).toEqual([]);
    expect(remainingTokens).toBe(100);
  });
});

// A sanity check that this test file's own pinned-tokenizer usage matches
// the one sanctioned counter, per CLAUDE.md #core/shared's tokens module
// being "the ONLY sanctioned way to count tokens anywhere in this repo".
describe('countTokens sanity', () => {
  it('is deterministic', () => {
    expect(countTokens('hello world')).toBe(countTokens('hello world'));
  });
});
