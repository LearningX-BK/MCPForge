// W0-P1 — stage 4's gate, the read-only custom-binding contract check.
//
// The pass case runs against THE REAL REPO, deliberately. This gate's whole
// claim is "every hand-owned binding body in this repository still matches
// its manifest", and a fixture cannot make that claim. The drift cases then
// copy the real manifests/ and generated/ trees into a throwaway root and
// perturb exactly one thing, so each failure mode is proven against real
// artefacts rather than invented ones.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCustomBindingContracts, runContractCheckGate } from './contract-check.js';

const here = dirname(fileURLToPath(import.meta.url));
/** tools/ci/src -> repo root. */
const REAL_REPO = join(here, '..', '..', '..');

/** A throwaway root holding real copies of the two trees this gate reads. */
function copyRealRepoTrees(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-contract-check-'));
  for (const tree of ['manifests', 'roles', 'packages', 'consumers', 'generated', 'enums']) {
    const from = join(REAL_REPO, tree);
    try {
      cpSync(from, join(dir, tree), { recursive: true });
    } catch {
      // `consumers/` and `enums/` are legitimately optional — loadManifestFiles
      // treats a missing directory as empty, and so does this gate.
    }
  }
  return dir;
}

describe('stage 4 — the custom-binding contract check, against the real repo', () => {
  it('passes: every hand-owned binding body in this repository matches its manifest', () => {
    const report = checkCustomBindingContracts(REAL_REPO);
    expect(report.drift).toEqual([]);
    expect(report.structural).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('checks a non-zero number of hand-owned bodies — a gate that checks nothing proves nothing', () => {
    // Four tools declare `bindingCustom: true` today (the two AP voucher
    // writes and the two GL journal writes). The assertion is deliberately
    // ">= 1", not "=== 4": adding a fifth custom binding is normal work and
    // must not break this test, but dropping to zero would silently empty
    // the gate and must break it.
    expect(checkCustomBindingContracts(REAL_REPO).customBindingsChecked).toBeGreaterThanOrEqual(1);
  });

  it('the stage wrapper reports passed and says how many bodies it checked', () => {
    const outcome = runContractCheckGate(REAL_REPO);
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain('every contract-hash matches its manifest');
  });
});

describe('stage 4 — each failure mode, against real artefacts in a throwaway root', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function firstCustomBindingToolId(): string {
    const report = checkCustomBindingContracts(REAL_REPO);
    expect(report.customBindingsChecked).toBeGreaterThanOrEqual(1);
    // Probe the real generated tree for whichever body exists rather than
    // pinning one id, so this suite follows the repo instead of fixing it.
    const candidates = [
      'jde.ap.voucher.cancel',
      'jde.ap.voucher.create',
      'jde.fin.journal.create',
      'jde.fin.journal.submit',
    ];
    for (const id of candidates) {
      try {
        readFileSync(join(REAL_REPO, 'generated', 'tools', id, 'binding.custom.ts'), 'utf8');
        return id;
      } catch {
        continue;
      }
    }
    throw new Error('no hand-owned binding body found in the real repo');
  }

  it('fails with CUSTOM_BINDING_CONTRACT_DRIFT when the embedded hash no longer matches the manifest', () => {
    root = copyRealRepoTrees();
    const toolId = firstCustomBindingToolId();
    const file = join(root, 'generated', 'tools', toolId, 'binding.custom.ts');
    const source = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      source.replace(/(mcpforge:contract-hash\s+)[0-9a-f]+/, '$1' + 'f'.repeat(64)),
      'utf8',
    );

    const report = checkCustomBindingContracts(root);
    expect(report.ok).toBe(false);
    expect(report.drift).toHaveLength(1);
    expect(report.drift[0]!.toolId).toBe(toolId);
    expect(report.drift[0]!.code).toBe('CUSTOM_BINDING_CONTRACT_DRIFT');
    expect(report.drift[0]!.foundHash).toBe('f'.repeat(64));
    expect(report.drift[0]!.fix).toContain(`--accept-contract ${toolId}`);

    const outcome = runContractCheckGate(root);
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('CUSTOM_BINDING_CONTRACT_DRIFT');
    expect(outcome.detail).toContain(toolId);
  });

  it('fails when the hash-comment marker is absent — an unverifiable file is not a passing one', () => {
    root = copyRealRepoTrees();
    const toolId = firstCustomBindingToolId();
    const file = join(root, 'generated', 'tools', toolId, 'binding.custom.ts');
    const source = readFileSync(file, 'utf8');
    writeFileSync(
      file,
      source
        .split('\n')
        .filter((line) => !line.includes('mcpforge:contract-hash'))
        .join('\n'),
      'utf8',
    );

    const report = checkCustomBindingContracts(root);
    expect(report.ok).toBe(false);
    expect(report.drift).toHaveLength(1);
    expect(report.drift[0]!.foundHash).toBeNull();
  });

  it('fails when a declared custom binding has no file at all', () => {
    root = copyRealRepoTrees();
    const toolId = firstCustomBindingToolId();
    rmSync(join(root, 'generated', 'tools', toolId, 'binding.custom.ts'), { force: true });

    const report = checkCustomBindingContracts(root);
    expect(report.ok).toBe(false);
    expect(report.structural).toHaveLength(1);
    expect(report.structural[0]!.toolId).toBe(toolId);
    expect(report.structural[0]!.message).toContain('does not exist');
    expect(report.structural[0]!.fix).toContain('forge codegen');
  });

  it('fails on an orphaned hand-owned file — a body whose manifest no longer declares bindingCustom', () => {
    root = copyRealRepoTrees();
    // Find a tool that does NOT declare a custom binding and plant a body for it.
    const orphanId = 'jde.scm.purchase_order.create';
    const donor = firstCustomBindingToolId();
    const dir = join(root, 'generated', 'tools', orphanId);
    mkdirSync(dir, { recursive: true });
    cpSync(
      join(root, 'generated', 'tools', donor, 'binding.custom.ts'),
      join(dir, 'binding.custom.ts'),
    );

    const report = checkCustomBindingContracts(root);
    expect(report.ok).toBe(false);
    const orphan = report.structural.find((s) => s.toolId === orphanId);
    expect(orphan).toBeDefined();
    expect(orphan!.message).toContain('no longer declares');
  });

  it('a repo with no custom bindings at all passes honestly, and says it checked none', () => {
    root = mkdtempSync(join(tmpdir(), 'mcpforge-contract-empty-'));
    const outcome = runContractCheckGate(root);
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain('0 hand-owned binding bodies');
  });

  it('never returns not_implemented', () => {
    root = copyRealRepoTrees();
    for (const candidate of [root, REAL_REPO, join(root, 'does-not-exist')]) {
      expect(runContractCheckGate(candidate).status).not.toBe('not_implemented');
    }
  });
});
