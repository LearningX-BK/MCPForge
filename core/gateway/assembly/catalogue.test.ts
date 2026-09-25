// MCPForge — W0-P13. The runtime catalogue resolver, against the REAL repo
// (agreement, all 11 tools) and against a temp copy of it (drift and
// `forge validate` failures refuse to start, naming the rule).
//
// The agreement checks read each manifest with a plain YAML parse, NOT with
// codegen's `readTool`, so they are an independent reading of the source the
// resolver claims to reflect rather than the resolver's own parser checking
// itself.

import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { CatalogueLoadRefused, loadRuntimeCatalogue, type RuntimeCatalogue } from './catalogue.js';
import type { PolicyCall } from '../policy/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toolManifests(root: string): { file: string; doc: Doc }[] {
  const out: { file: string; doc: Doc }[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.tool.yaml')) {
        out.push({
          file: relative(root, full).split('\\').join('/'),
          doc: parseYaml(readFileSync(full, 'utf8')) as Doc,
        });
      }
    }
  };
  walk(join(root, 'manifests'));
  return out;
}

const MANIFESTS = toolManifests(REPO_ROOT);

let catalogue: RuntimeCatalogue;
beforeAll(async () => {
  catalogue = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
}, 60_000);

function call(toolId: string, args: Record<string, unknown>): PolicyCall {
  return { toolId, entryPoint: 'tools/call', args, correlationId: 'corr-p13' };
}

describe('W0-P13 — the runtime catalogue resolves every shipped tool', () => {
  it('holds exactly the 11 tools under manifests/, no more and no fewer', () => {
    expect(MANIFESTS).toHaveLength(11);
    expect(catalogue.toolIds).toEqual(MANIFESTS.map((m) => m.doc['id'] as string).sort());
    expect(catalogue.entries.map((e) => e.toolId)).toEqual(catalogue.toolIds);
  });

  describe.each(MANIFESTS.map((m) => [m.doc['id'] as string, m] as const))('%s', (id, m) => {
    const doc = m.doc;
    const ws = doc['writeSafety'] as Doc | undefined;

    it('PolicyCatalogueEntry agrees with the manifest', () => {
      const entry = catalogue.entryFor(id)!;
      expect(entry.toolId).toBe(doc['id']);
      expect(entry.toolVersion).toBe(doc['version']);
      expect(entry.serverId).toBe(doc['server']);
      expect(entry.write).toBe(doc['write'] === true);
      expect(entry.sensitivity).toBe(doc['sensitivity']);
      expect(entry.bindingType).toBe(doc['binding']['type']);
      expect(entry.bindingRef).toBe(doc['binding']['ref']);
      expect(entry.policyException ?? null).toBe(doc['governance']?.['policyException'] ?? null);
      expect(entry.resultKeys).toEqual(doc['output']?.['resultKeys'] ?? []);
      if (ws === undefined) {
        expect(entry.humanApprovalRequired).toBeUndefined();
        expect(entry.guardrails).toBeUndefined();
        expect(entry.reversal).toBeUndefined();
      } else {
        expect(entry.humanApprovalRequired).toBe(ws['humanApprovalRequired'] === true);
        expect(entry.guardrails).toEqual(ws['guardrails'] ?? []);
        expect(entry.reversal).toEqual(ws['reversal']);
      }
    });

    it('WriteSafetyView and the reversal registry agree with the manifest', () => {
      const view = catalogue.writeSafetyFor(id);
      if (ws === undefined) {
        expect(doc['write']).not.toBe(true);
        expect(view).toBeUndefined();
        expect(catalogue.reversals.contractFor(id)).toBeUndefined();
        return;
      }
      expect(view).toEqual({
        toolId: doc['id'],
        toolVersion: doc['version'],
        planTemplate: ws['confirm']['planTemplate'],
        tokenTtlSeconds: ws['confirm']['tokenTtlSeconds'],
        humanApprovalRequired: ws['humanApprovalRequired'] === true,
        reversal: ws['reversal'],
        dryRunStrategy: ws['dryRun']['strategy'],
        entity: doc['entity'],
        verb: doc['verb'],
      });
      expect(view!.dryRunStrategy).not.toBe('none');
      expect(catalogue.reversals.contractFor(id)).toEqual(ws['reversal']);
      // Idempotency is the one write-safety field not carried by these views;
      // the resolver checked it against the generated registration instead.
      expect(catalogue.tools.get(id)!.view.writeSafety!.idempotencyScopeHours).toBe(
        ws['idempotency']['scopeHours'],
      );
    });

    it('the function binding descriptor comes from binding.* and nowhere else', () => {
      const d = catalogue.functionDescriptorFor(id);
      if (doc['binding']['type'] !== 'function') {
        expect(d).toBeUndefined();
        return;
      }
      const b = doc['binding'] as Doc;
      expect(d).toMatchObject({
        toolId: id,
        toolVersion: doc['version'],
        write: doc['write'] === true,
        ref: b['ref'],
        refVersion: b['refVersion'] ?? null,
        identity: { echoOn: b['identity']['echoOn'], probe: b['identity']['probe'] ?? null },
        execution: {
          timeoutMs: b['execution']['timeoutMs'],
          maxConcurrency: b['execution']['maxConcurrency'] ?? 4,
          responseBytesMax: b['execution']['responseBytesMax'],
        },
      });
      expect(Object.keys(d!.inputMapping).sort()).toEqual(
        (doc['input'] as Doc[]).map((i) => i['name']).sort(),
      );
      expect(Object.isFrozen(d)).toBe(true);
    });

    it('6d validates against the COMMITTED generated schema.json', () => {
      const committed = JSON.parse(
        readFileSync(join(REPO_ROOT, 'generated', 'tools', id, 'schema.json'), 'utf8'),
      );
      expect(catalogue.tools.get(id)!.schema).toEqual(committed);
      const entry = catalogue.entryFor(id)!;
      const verdict = catalogue.argumentValidator.validate(
        call(id, { not_a_declared_input: 'x' }),
        entry,
      );
      expect(verdict.valid).toBe(false);
    });
  });
});

describe('W0-P13 — stage 6d is compiled Ajv, and fails closed', () => {
  const CREATE = 'jde.ap.voucher.create';
  const ARGS = { supplier_number: '4242', amount: 18_400, currency: 'GBP', company: '00100' };

  it('accepts a well-formed call, including the plan/confirm `confirm` field', () => {
    const entry = catalogue.entryFor(CREATE)!;
    expect(catalogue.argumentValidator.validate(call(CREATE, ARGS), entry)).toEqual({
      valid: true,
    });
    expect(
      catalogue.argumentValidator.validate(call(CREATE, { ...ARGS, confirm: 'tok' }), entry),
    ).toEqual({ valid: true });
  });

  it('names every offending field at once', () => {
    const entry = catalogue.entryFor(CREATE)!;
    const verdict = catalogue.argumentValidator.validate(
      call(CREATE, { amount: 0, currency: 'GBP', company: '00100', gl_date: 'not-a-date' }),
      entry,
    );
    expect(verdict.valid).toBe(false);
    const errors = (verdict as { errors: string }).errors;
    expect(errors).toContain('supplier_number');
    expect(errors).toContain('/amount');
    expect(errors).toContain('/gl_date');
  });

  it('refuses a tool the catalogue does not hold, and a call/entry mismatch', () => {
    const entry = catalogue.entryFor(CREATE)!;
    expect(
      catalogue.argumentValidator.validate(call(CREATE, ARGS), {
        ...entry,
        toolId: 'jde.ap.voucher.nope',
      }).valid,
    ).toBe(false);
    expect(
      catalogue.argumentValidator.validate(call('jde.ap.voucher.cancel', ARGS), entry).valid,
    ).toBe(false);
  });

  it('the executor-facing validator is the same compiled function 6d uses', () => {
    expect(catalogue.schemaValidatorFor(CREATE)).toBe(catalogue.tools.get(CREATE)!.validate);
    expect(catalogue.schemaValidatorFor('jde.ap.voucher.nope')).toBeUndefined();
  });
});

// --- refusal: a temp copy of the repo, mutated one way per test ---------------

const COPY_DIRS = ['manifests', 'roles', 'packages', 'consumers', 'enums', 'evals', 'approvals'];
const temps: string[] = [];

function repoCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-p13-'));
  temps.push(root);
  for (const d of COPY_DIRS) {
    try {
      cpSync(join(REPO_ROOT, d), join(root, d), { recursive: true });
    } catch {
      // `consumers/` etc. may be absent; validateRepo treats them as optional.
    }
  }
  for (const e of readdirSync(join(REPO_ROOT, 'generated', 'tools'), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const id = e.name;
    for (const f of ['tool.ts', 'schema.json']) {
      cpSync(join(REPO_ROOT, 'generated', 'tools', id, f), join(root, 'generated', 'tools', id, f));
    }
  }
  return root;
}

function edit(root: string, rel: string, fn: (text: string) => string): void {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`test edit to ${rel} changed nothing`);
  writeFileSync(p, after);
}

async function refusal(root: string): Promise<CatalogueLoadRefused> {
  try {
    await loadRuntimeCatalogue({ repoRoot: root });
  } catch (error) {
    if (error instanceof CatalogueLoadRefused) return error;
    throw error;
  }
  throw new Error('loadRuntimeCatalogue started over a repo it should have refused');
}

afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

describe('W0-P13 — anything but a clean, in-sync repo refuses to start', () => {
  const GEN = 'generated/tools/jde.ap.voucher.cancel';
  const MANIFEST = 'manifests/jde/fin/ap/voucher.cancel.tool.yaml';

  it('the unmodified copy loads (so every refusal below is caused by its one edit)', async () => {
    const c = await loadRuntimeCatalogue({ repoRoot: repoCopy() });
    expect(c.toolIds).toHaveLength(11);
  }, 60_000);

  it('a forge validate failure refuses, naming forge validate’s own rule', async () => {
    const root = repoCopy();
    // Non-negotiable #2: only the probe may ever write `verified`.
    edit(root, MANIFEST, (t) => t.replace(/carries:\s*unverified/, 'carries: verified'));
    const r = await refusal(root);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(r.failures.every((f) => !f.ruleId.startsWith('assembly.'))).toBe(true);
    expect(r.failures.some((f) => f.file === MANIFEST)).toBe(true);
    expect(r.message).toContain(r.failures[0]!.ruleId);
  }, 60_000);

  it('a manifest edited without regenerating refuses (manifest-sha256)', async () => {
    const root = repoCopy();
    edit(root, MANIFEST, (t) => `${t}\n# an edit nobody regenerated\n`);
    const r = await refusal(root);
    expect(r.failures.map((f) => f.ruleId)).toEqual([
      'assembly.manifest-sha256',
      'assembly.manifest-sha256',
      // cancel no longer resolves, so create's declared reversing tool is gone too.
      'assembly.reversal-tool-unresolved',
    ]);
    expect(r.failures[0]!.file).toBe(`${GEN}/tool.ts`);
    expect(r.failures[1]!.file).toBe(`${GEN}/schema.json`);
  }, 60_000);

  it('a hand-edited schema.json refuses (schema-drift)', async () => {
    const root = repoCopy();
    edit(root, `${GEN}/schema.json`, (t) =>
      t.replace('"additionalProperties": false', '"additionalProperties": true'),
    );
    const r = await refusal(root);
    expect(r.failures[0]).toMatchObject({
      ruleId: 'assembly.schema-drift',
      file: `${GEN}/schema.json`,
    });
  }, 60_000);

  it('a hand-edited registration refuses (registration-drift), naming the field', async () => {
    const root = repoCopy();
    edit(root, `${GEN}/tool.ts`, (t) =>
      t.replace('humanApprovalRequired: true', 'humanApprovalRequired: false'),
    );
    const r = await refusal(root);
    expect(r.failures[0]).toMatchObject({
      ruleId: 'assembly.registration-drift',
      file: `${GEN}/tool.ts`,
    });
    expect(r.failures[0]!.message).toContain('writeSafety.humanApprovalRequired');
  }, 60_000);

  it('a manifest with no generated tree refuses (generated-missing)', async () => {
    const root = repoCopy();
    rmSync(join(root, GEN), { recursive: true });
    const r = await refusal(root);
    expect(r.failures[0]).toMatchObject({ ruleId: 'assembly.generated-missing', file: GEN });
  }, 60_000);

  it('a generated tree with no manifest refuses (generated-orphan)', async () => {
    const root = repoCopy();
    cpSync(join(root, GEN), join(root, 'generated/tools/jde.ap.voucher.ghost'), {
      recursive: true,
    });
    const r = await refusal(root);
    expect(r.failures[0]).toMatchObject({
      ruleId: 'assembly.generated-orphan',
      file: 'generated/tools/jde.ap.voucher.ghost',
    });
  }, 60_000);
});
