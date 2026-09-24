// MCPForge — W0-B6 tests. Every clause of the task's `done:` criterion,
// proven against the `jde.ap.voucher.create` fixture (the `bindingCustom:
// true` variant at `../emit/fixtures-custom`, shared with W0-B5, since the
// handler must demonstrably dispatch into `binding.custom.ts`).

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { countTokens } from '@mcpforge/shared/tokens';
import { runCodegen } from '../emit/pipeline.js';
import { readGeneratedFile } from '../emit/writer.js';
import { cardWireShape } from './card.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRepoRoot = join(here, '..', 'emit', 'fixtures-custom');
const TOOL_ID = 'jde.ap.voucher.create';
const TOOL_DIR = join('generated', 'tools', TOOL_ID);

const tmpDirs: string[] = [];

function freshRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-templates-'));
  tmpDirs.push(dir);
  cpSync(join(fixturesRepoRoot, 'manifests'), join(dir, 'manifests'), { recursive: true });
  // W0-B8: role scopes are compiled from `roles/<id>.yaml`, not from each
  // tool's `coreForRoles`, so the fixture's roles/ tree must come across too.
  cpSync(join(fixturesRepoRoot, 'roles'), join(dir, 'roles'), { recursive: true });
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('W0-B6 DONE CRITERION: all six/seven artefacts are produced for jde.ap.voucher.create', () => {
  it('writes schema.json, tool.ts, handler.generated.ts, unit.test.ts, docs, card and a role scope', async () => {
    const repoRoot = freshRepoRoot();
    const report = await runCodegen(repoRoot);

    expect(report.ok).toBe(true);
    expect(report.filesWritten).toEqual(
      expect.arrayContaining([
        `${TOOL_DIR}/schema.json`.replace(/\\/g, '/'),
        `${TOOL_DIR}/tool.ts`.replace(/\\/g, '/'),
        `${TOOL_DIR}/handler.generated.ts`.replace(/\\/g, '/'),
        `${TOOL_DIR}/unit.test.ts`.replace(/\\/g, '/'),
        `${TOOL_DIR}/contract.test.ts`.replace(/\\/g, '/'),
        `generated/docs/tools/${TOOL_ID}.md`,
        `generated/cards/${TOOL_ID}.json`,
        'generated/roles/p2p.scope.json',
      ]),
    );
  });
});

describe('W0-B6 DONE CRITERION: schema.json (artefact 1)', () => {
  it('is draft 2020-12, carries the manifest inputs and the confirm field for a write tool', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const schema = JSON.parse(
      readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/schema.json`.split('/'))),
    ) as Record<string, unknown>;

    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    const properties = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['supplier_number', 'po_number', 'amount', 'currency', 'company', 'gl_date', 'confirm']),
    );
    expect(schema['required']).toEqual(
      expect.arrayContaining(['supplier_number', 'amount', 'currency', 'company']),
    );
    expect(schema['required']).not.toContain('confirm');
    expect(properties['confirm']).toEqual({
      type: ['string', 'null'],
      description:
        'Omit or null to PLAN (no change is made). Pass the confirmToken returned by the plan to EXECUTE.',
    });
    // Ajv-compilable: this is the exact schema the generated handler compiles.
    const { Ajv2020 } = await import('ajv/dist/2020.js');
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(schema);
    expect(
      validate({
        supplier_number: '4242',
        amount: 100,
        currency: 'GBP',
        company: '00100',
      }),
    ).toBe(true);
  });
});

describe('W0-B6 DONE CRITERION: tool.ts (artefact 2)', () => {
  it('carries id, version, sensitivity, write flag, guardrails and role tags', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/tool.ts`.split('/')));

    expect(source).toContain('export const toolRegistration');
    expect(source).toContain('id: "jde.ap.voucher.create"');
    expect(source).toContain('sensitivity: "financial"');
    expect(source).toContain('write: true');
    expect(source).toContain('"maxNumeric"');
    expect(source).toContain('coreForRoles: ["p2p"]');
  });
});

describe('W0-B6 DONE CRITERION: handler.generated.ts wires all six concerns (artefact 3)', () => {
  it('wires argument validation (compiled Ajv from schema.json)', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toMatch(/from ['"]\.\/schema\.json['"]/);
    expect(source).toContain('Ajv2020');
    expect(source).toContain('ajv.compile(schema)');
    expect(source).toContain('validateArgs(rawArgs)');
  });

  it('wires two-phase confirm / dry-run dispatch into binding.custom.ts execute/dryRun', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toMatch(/from ['"]\.\/binding\.custom\.js['"]/);
    expect(source).toContain('customBinding.dryRun(ctx, args)');
    expect(source).toContain('customBinding.execute(ctx, args)');
    expect(source).toContain('isPlan');
    expect(source).toContain('confirmTokens.mint');
    expect(source).toContain('confirmTokens.verify');
  });

  it('wires guardrail evaluation from writeSafety.guardrails', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toContain('evaluateGuardrails');
    expect(source).toContain('GUARDRAILS');
    expect(source).toContain('POLICY_GUARDRAIL_BREACH');
  });

  it('wires result-key extraction from output.resultKeys', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toContain('RESULT_KEYS');
    expect(source).toContain('extractResultKeys');
    expect(source).toContain('document_number');
    expect(source).toContain('$.voucher.docNumber');
  });

  it('wires audit calls (a documented Track C call-site stub)', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toContain('ctx.audit.record');
    expect(source).toContain('AuditRecordInput');
    expect(source).toMatch(/phase:\s*"plan"/);
    expect(source).toMatch(/phase:\s*"execute"/);
  });

  it('maps errors to the closed taxonomy from @mcpforge/shared', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toMatch(/from ['"]@mcpforge\/shared\/errors['"]/);
    expect(source).toContain('forgeError(');
    expect(source).toContain('INPUT_INVALID');
    expect(source).toContain('PLAN_ARGUMENT_MISMATCH');
    expect(source).toContain('TARGET_ERROR');
  });

  it('exports Ctx/Args/Result — the exact types binding.custom.ts\'s stub imports', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/handler.generated.ts`.split('/')));
    expect(source).toContain('export interface Args');
    expect(source).toContain('export interface Ctx');
    expect(source).toContain('export interface Result');
    // The hand-owned stub's own import line, byte-checked against custom.ts's rendering.
    const stub = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/binding.custom.ts`.split('/')));
    expect(stub).toMatch(/from ['"]\.\/handler\.generated['"]/);
  });
});

describe('W0-B6 DONE CRITERION: unit.test.ts is schema-boundary only (artefact 4)', () => {
  it('covers required fields, type coercion and guardrail thresholds, not full contract round trips', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const source = readGeneratedFile(join(repoRoot, ...`${TOOL_DIR}/unit.test.ts`.split('/')));
    expect(source).toMatch(/from ['"]\.\/handler\.generated\.js['"]/);
    expect(source).toContain('rejects a call missing required field');
    expect(source).toContain('rejects the wrong type for');
    expect(source).toContain('guardrail on "amount"');
    // Scope boundary: no confirm-token / idempotency / reversal round-trip
    // assertions here — that is W0-B7's contract.test.ts, not this file.
    expect(source).not.toContain('confirmToken');
    expect(source).not.toContain('idempoten');
  });
});

describe('W0-B6 DONE CRITERION: docs (artefact 5)', () => {
  it('is generated from the manifest and documents the two-phase write path', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const md = readGeneratedFile(join(repoRoot, 'generated', 'docs', 'tools', `${TOOL_ID}.md`));
    expect(md).toContain(`# ${TOOL_ID}`);
    expect(md).toContain('Create an AP voucher against a supplier');
    expect(md).toContain('two-phase');
    expect(md).toContain('jde.ap.voucher.cancel');
  });
});

describe('W0-B6 DONE CRITERION: discovery card measures <=60 tokens with the pinned counter (artefact 6)', () => {
  it('the generated card is at or under the §5.3(a) budget, measured by the real pinned tokenizer', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const card = JSON.parse(
      readGeneratedFile(join(repoRoot, 'generated', 'cards', `${TOOL_ID}.json`)),
    ) as Record<string, unknown>;
    const wire = cardWireShape(card);
    const tokens = countTokens(JSON.stringify(wire));
    expect(tokens).toBeLessThanOrEqual(60);
    expect(wire).toMatchObject({
      id: TOOL_ID,
      verb: 'create',
      entity: 'voucher',
      write: true,
      binding: 'function',
      sensitivity: 'financial',
    });
    expect((wire['roles'] as string[])).toContain('p2p');
  });
});

describe('W0-B6 DONE CRITERION: role scope (artefact 7) — now compiled by W0-B8', () => {
  // W0-B6's minimal `coreForRoles` stub was superseded and REMOVED by W0-B8;
  // `generated/roles/p2p.scope.json` is now compiled from `roles/p2p.yaml`'s
  // globs (02 §4.3) by core/codegen/src/compile/. The artefact this task
  // asserted on still exists at the same path, still names the fixture tool,
  // and no longer carries the stub's `note`.
  it('generated/roles/p2p.scope.json names the fixture tool id', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const scope = JSON.parse(
      readGeneratedFile(join(repoRoot, 'generated', 'roles', 'p2p.scope.json')),
    ) as Record<string, unknown>;
    expect(scope['roleId']).toBe('p2p');
    expect(scope['toolIds']).toEqual([TOOL_ID]);
    expect(scope['note']).toBeUndefined();
  });
});

describe('W0-B6: regeneration invariant still holds with real artefacts (not just the W0-B4 placeholder)', () => {
  // NOTE: `binding.custom.ts` (W0-B5) is created ONCE and never listed as
  // "written" again on a subsequent unchanged run — that is its own done
  // criterion, proven in `../emit/custom.test.ts`, not this task's. This
  // test instead proves the seven W0-B6 artefacts (the ones this task's own
  // pipeline changes write on every run) are byte-identical across two runs.
  const SEVEN_ARTEFACTS = [
    `${TOOL_DIR}/schema.json`,
    `${TOOL_DIR}/tool.ts`,
    `${TOOL_DIR}/handler.generated.ts`,
    `${TOOL_DIR}/unit.test.ts`,
    `${TOOL_DIR}/contract.test.ts`,
    `generated/docs/tools/${TOOL_ID}.md`,
    `generated/cards/${TOOL_ID}.json`,
    'generated/roles/p2p.scope.json',
  ].map((p) => p.replace(/\\/g, '/'));

  it('two consecutive runs are byte-identical across every one of the seven artefacts', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const firstBytes = SEVEN_ARTEFACTS.map((f) => readGeneratedFile(join(repoRoot, ...f.split('/'))));

    await runCodegen(repoRoot);
    const secondBytes = SEVEN_ARTEFACTS.map((f) => readGeneratedFile(join(repoRoot, ...f.split('/'))));

    expect(secondBytes).toEqual(firstBytes);
  });

  it('deleting generated/ and regenerating reproduces every artefact byte-identically', async () => {
    const repoRoot = freshRepoRoot();
    await runCodegen(repoRoot);
    const firstBytes = SEVEN_ARTEFACTS.map((f) => readGeneratedFile(join(repoRoot, ...f.split('/'))));

    rmSync(join(repoRoot, 'generated'), { recursive: true, force: true });

    await runCodegen(repoRoot);
    const secondBytes = SEVEN_ARTEFACTS.map((f) => readGeneratedFile(join(repoRoot, ...f.split('/'))));

    expect(secondBytes).toEqual(firstBytes);
  });
});

// Sanity: the shared fixture manifest is present.
describe('fixture manifest', () => {
  it('is present, non-empty, and declares bindingCustom: true', () => {
    const content = readFileSync(
      join(fixturesRepoRoot, 'manifests', 'jde', 'fin', 'ap', 'voucher.create.tool.yaml'),
      'utf8',
    );
    expect(content).toContain('bindingCustom: true');
  });
});
