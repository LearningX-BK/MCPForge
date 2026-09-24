// MCPForge — W0-B5 tests. Every clause of the task's `done:` criterion,
// plus the 02 §2.4 properties the criterion rests on.

import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_HASH_MARKER,
  CUSTOM_BINDING_CONTRACT_DRIFT,
  acceptContract,
  contractHash,
  contractSnapshot,
  customBindingPath,
  diffContracts,
  formatContractDriftHuman,
  hasCustomBinding,
  readContractHashComment,
  replaceContractHashComment,
} from './custom.js';
import { runCodegen } from './pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRepoRoot = join(here, 'fixtures-custom');
const MANIFEST_REL = 'manifests/jde/fin/ap/voucher.create.tool.yaml';
const TOOL_ID = 'jde.ap.voucher.create';

const tmpDirs: string[] = [];

function freshRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-custom-'));
  tmpDirs.push(dir);
  cpSync(join(fixturesRepoRoot, 'manifests'), join(dir, 'manifests'), { recursive: true });
  // W0-B8: role scopes are compiled from `roles/<id>.yaml`, not from each
  // tool's `coreForRoles`, so the fixture's roles/ tree must come across too.
  cpSync(join(fixturesRepoRoot, 'roles'), join(dir, 'roles'), { recursive: true });
  return dir;
}

function manifestAbs(repoRoot: string): string {
  return join(repoRoot, ...MANIFEST_REL.split('/'));
}

/** Change `amount`'s declared type from number to string — the done criterion's "changing an input type". */
function changeAmountType(repoRoot: string): void {
  const path = manifestAbs(repoRoot);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(
    '{ name: amount,          type: number,',
    '{ name: amount,          type: string,',
  );
  expect(after).not.toBe(before);
  writeFileSync(path, after, 'utf8');
}

function readCustom(repoRoot: string): string {
  return readFileSync(customBindingPath(repoRoot, TOOL_ID), 'utf8');
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('contract hash — 02 §2.4 narrow field set', () => {
  const base = {
    binding: { ref: 'AP_VOUCHER_CREATE', refVersion: '1.4' },
    input: [
      { name: 'amount', type: 'number', required: true, desc: 'a' },
      { name: 'company', type: 'string', required: true, desc: 'b' },
    ],
    output: { resultKeys: [{ name: 'document_number', path: '$.voucher.docNumber' }] },
    writeSafety: { dryRun: { strategy: 'validate-pair' } },
  };

  it('is stable and order-independent for the same contract', () => {
    const reordered = { ...base, input: [...base.input].reverse() };
    expect(contractHash(contractSnapshot(TOOL_ID, base))).toBe(
      contractHash(contractSnapshot(TOOL_ID, reordered)),
    );
    expect(contractHash(contractSnapshot(TOOL_ID, base))).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ignores fields the custom body cannot depend on (desc, example, purpose)', () => {
    const noisy = {
      ...base,
      purpose: 'totally different copy',
      input: base.input.map((i) => ({ ...i, desc: 'rewritten', example: '9' })),
    };
    expect(contractHash(contractSnapshot(TOOL_ID, noisy))).toBe(
      contractHash(contractSnapshot(TOOL_ID, base)),
    );
  });

  it('changes on an input type, a result key, binding.ref/refVersion and dryRun.strategy', () => {
    const h = contractHash(contractSnapshot(TOOL_ID, base));
    const variants = [
      { ...base, input: [{ ...base.input[0]!, type: 'string' }, base.input[1]!] },
      { ...base, output: { resultKeys: [...base.output.resultKeys, { name: 'x', path: '$.x' }] } },
      { ...base, binding: { ...base.binding, ref: 'OTHER' } },
      { ...base, binding: { ...base.binding, refVersion: '1.5' } },
      { ...base, writeSafety: { dryRun: { strategy: 'native' } } },
    ];
    for (const v of variants) {
      expect(contractHash(contractSnapshot(TOOL_ID, v))).not.toBe(h);
    }
  });
});

describe('hasCustomBinding', () => {
  it('is true only for bindingCustom: true', () => {
    expect(hasCustomBinding({ bindingCustom: true })).toBe(true);
    expect(hasCustomBinding({ bindingCustom: false })).toBe(false);
    expect(hasCustomBinding({})).toBe(false);
    expect(hasCustomBinding(null)).toBe(false);
  });
});

describe('the hash comment', () => {
  const file = [
    '// HAND-OWNED. codegen will never overwrite this file.',
    `// ${CONTRACT_HASH_MARKER} a91c4e02`,
    'const hand = 1;',
    '',
  ].join('\n');

  it('is read back exactly', () => {
    expect(readContractHashComment(file)).toBe('a91c4e02');
    expect(readContractHashComment('no marker here')).toBeNull();
  });

  it('is rewritten line-surgically, leaving every other byte alone', () => {
    const out = replaceContractHashComment(file, 'ffff0000');
    expect(readContractHashComment(out)).toBe('ffff0000');
    const before = file.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    after.forEach((line, i) => {
      if (i === 1) return;
      expect(line).toBe(before[i]);
    });
  });
});

describe('DONE CRITERION: created once with a typed stub, never written again', () => {
  it('creates the stub with the hand-owned banner, the hash comment and typed execute/dryRun', async () => {
    const repoRoot = freshRepoRoot();
    const report = await runCodegen(repoRoot);

    expect(report.ok).toBe(true);
    expect(report.customBindingsCreated).toEqual([TOOL_ID]);
    expect(report.filesWritten).toContain(`generated/tools/${TOOL_ID}/binding.custom.ts`);

    const stub = readCustom(repoRoot);
    expect(stub.split('\n')[0]).toBe('// HAND-OWNED. codegen will never overwrite this file.');
    expect(readContractHashComment(stub)).toMatch(/^[0-9a-f]{8}$/);
    // Quote style comes from the repo's own prettier config via the W0-B4
    // writer, so the assertion is quote-agnostic.
    expect(stub).toMatch(
      /import type \{ Ctx, Args, Result \} from ['"]\.\/handler\.generated['"];/,
    );
    expect(stub).toContain('export async function execute(ctx: Ctx, args: Args): Promise<Result>');
    expect(stub).toContain('export async function dryRun(ctx: Ctx, args: Args): Promise<Result>');
    expect(stub).toContain(`NOT_IMPLEMENTED: ${TOOL_ID} binding body`);
  });

  it('leaves a hand-edited file byte-identical AND untouched (mtime unchanged) on an unchanged manifest', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);

    // A human writes the real body. Only the hash line is codegen's business.
    const absPath = customBindingPath(repoRoot, TOOL_ID);
    const handWritten = readCustom(repoRoot).replace(
      `NOT_IMPLEMENTED: ${TOOL_ID} binding body`,
      'real hand-written body would go here',
    );
    writeFileSync(absPath, handWritten, 'utf8');
    const mtimeBefore = statSync(absPath).mtimeMs;

    const second = await runCodegen(repoRoot);

    expect(second.ok).toBe(true);
    expect(second.customBindingsCreated).toEqual([]);
    // Not merely content-equal: the file was never opened for writing.
    expect(readCustom(repoRoot)).toBe(handWritten);
    expect(statSync(absPath).mtimeMs).toBe(mtimeBefore);
    expect(second.filesWritten).not.toContain(`generated/tools/${TOOL_ID}/binding.custom.ts`);
  });
});

describe('DONE CRITERION: a changed input type fails with CUSTOM_BINDING_CONTRACT_DRIFT', () => {
  it('names the exact changed field, leaves the file byte-identical, and fails the build', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const absPath = customBindingPath(repoRoot, TOOL_ID);
    const bytesBefore = readCustom(repoRoot);
    const mtimeBefore = statSync(absPath).mtimeMs;

    changeAmountType(repoRoot);
    const report = await runCodegen(repoRoot);

    expect(report.ok).toBe(false);
    expect(report.contractDrift).toHaveLength(1);
    const drift = report.contractDrift[0]!;
    expect(drift.code).toBe(CUSTOM_BINDING_CONTRACT_DRIFT);
    expect(drift.toolId).toBe(TOOL_ID);
    expect(drift.file).toBe(`generated/tools/${TOOL_ID}/binding.custom.ts`);
    expect(drift.changed).toEqual([
      'input.amount (changed, was required, number, now required, string)',
    ]);
    expect(drift.fix).toBe(`update the file, then \`forge codegen --accept-contract ${TOOL_ID}\``);

    // The hand-owned file was not touched.
    expect(readCustom(repoRoot)).toBe(bytesBefore);
    expect(statSync(absPath).mtimeMs).toBe(mtimeBefore);

    // 02 §2.4's worked block shape.
    const human = formatContractDriftHuman(drift);
    expect(human.split('\n')[0]).toBe(`${CUSTOM_BINDING_CONTRACT_DRIFT}  ${TOOL_ID}`);
    expect(human).toContain('  changed: input.amount');
    expect(human).toContain(`  file:    generated/tools/${TOOL_ID}/binding.custom.ts`);
    expect(human).toContain(`  fix:     update the file, then \`forge codegen --accept-contract`);
  });

  it('still fails (without naming fields) when the contract snapshot is unavailable', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    rmSync(join(repoRoot, 'generated', 'tools', TOOL_ID, 'contract.json'), { force: true });

    changeAmountType(repoRoot);
    const report = await runCodegen(repoRoot);

    expect(report.ok).toBe(false);
    expect(report.contractDrift[0]!.changed[0]).toContain('cannot be named');
  });

  it('diffContracts renders added and removed entries in 02 §2.4 grammar', () => {
    const before = contractSnapshot(TOOL_ID, {
      input: [{ name: 'a', type: 'string', required: true }],
      output: { resultKeys: [{ name: 'k1', path: '$.a' }] },
    });
    const after = contractSnapshot(TOOL_ID, {
      input: [
        { name: 'a', type: 'string', required: true },
        { name: 'gl_date', type: 'string', required: false, format: 'date' },
      ],
      output: {
        resultKeys: [
          { name: 'k1', path: '$.a' },
          { name: 'document_company', path: '$.voucher.docCo' },
        ],
      },
    });
    expect(diffContracts(before, after)).toEqual([
      'input.gl_date (added, optional, string/date)',
      'output.resultKeys.document_company (added)',
    ]);
  });
});

describe('DONE CRITERION: --accept-contract', () => {
  it('rewrites ONLY the hash comment line and clears the drift', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const absPath = customBindingPath(repoRoot, TOOL_ID);
    writeFileSync(
      absPath,
      readCustom(repoRoot).replace(
        `NOT_IMPLEMENTED: ${TOOL_ID} binding body`,
        'the real hand-written body',
      ),
      'utf8',
    );
    const before = readCustom(repoRoot);

    changeAmountType(repoRoot);
    expect((await runCodegen(repoRoot)).ok).toBe(false);

    // Accept against the real manifest on disk, so the accepted hash is
    // exactly the one the next codegen run recomputes.
    const { findToolManifest } = await import('./pipeline.js');
    const found = findToolManifest(repoRoot, TOOL_ID)!;
    const result = await acceptContract({
      repoRoot,
      toolId: TOOL_ID,
      doc: found.doc,
      env: {},
    });

    expect(result.ok).toBe(true);
    const after = readCustom(repoRoot);
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(afterLines).toHaveLength(beforeLines.length);
    let changedLines = 0;
    afterLines.forEach((line, i) => {
      if (line !== beforeLines[i]) {
        changedLines += 1;
        expect(line).toMatch(new RegExp(`^// ${CONTRACT_HASH_MARKER} [0-9a-f]{8}$`));
      }
    });
    expect(changedLines).toBe(1);

    // And the build is green again, with the file still untouched thereafter.
    const third = await runCodegen(repoRoot);
    expect(third.ok).toBe(true);
    expect(readCustom(repoRoot)).toBe(after);
  });

  it('is REFUSED when CI=true', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const before = readCustom(repoRoot);
    changeAmountType(repoRoot);

    const { findToolManifest } = await import('./pipeline.js');
    const found = findToolManifest(repoRoot, TOOL_ID)!;

    const previousCi = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      // Reads process.env by default — exactly the path the CLI takes.
      const result = await acceptContract({ repoRoot, toolId: TOOL_ID, doc: found.doc });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ACCEPT_CONTRACT_REFUSED');
        expect(result.message).toContain('CI=true');
        expect(result.next.length).toBeGreaterThan(0);
      }
    } finally {
      if (previousCi === undefined) delete process.env['CI'];
      else process.env['CI'] = previousCi;
    }

    // Refused means refused: the file is untouched.
    expect(readCustom(repoRoot)).toBe(before);
  });

  it('refuses when there is no hand-owned file to accept against', async () => {
    const repoRoot = freshRepoRoot();
    const result = await acceptContract({ repoRoot, toolId: TOOL_ID, doc: {}, env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('no generated/tools');
  });
});
