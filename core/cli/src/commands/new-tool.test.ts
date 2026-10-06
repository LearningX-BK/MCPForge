import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { validateRepo } from '@mcpforge/codegen/validate';
import { BINDING_TYPES, scaffoldTool } from './new-tool-scaffold.js';
import { runNewToolCommand } from './new-tool.js';

const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function ok(answers: Parameters<typeof scaffoldTool>[0]) {
  const r = scaffoldTool(answers);
  if (!r.ok) throw new Error(r.message);
  return r;
}

/** A scratch repo holding only what `forge validate` needs besides the scaffold. */
function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-new-tool-'));
  cpSync(join(REAL_ROOT, 'manifests', '_servers'), join(root, 'manifests', '_servers'), {
    recursive: true,
  });
  cpSync(join(REAL_ROOT, 'enums'), join(root, 'enums'), { recursive: true });
  return root;
}

/** The leaf name of a failure path, e.g. "/writeSafety/reversal/tool" -> dotted form. */
const dotted = (p: string): string => p.replace(/^\//, '').replace(/\/(\d+)(?=\/|$)/g, '').replace(/\//g, '.');

describe('scaffoldTool', () => {
  it('reads: scaffolds a read tool with no writeSafety and names the human fields', () => {
    const r = ok({ id: 'jde.ap.supplier_note.get', server: 'jde-fin-ap' });
    const doc = parseYaml(r.yaml) as Record<string, unknown>;
    expect(doc['write']).toBe(false);
    expect(doc['writeSafety']).toBeUndefined();
    expect(r.path).toBe('manifests/jde/ap/supplier_note.get.tool.yaml');
    expect(r.humanFields).toEqual(
      expect.arrayContaining(['purpose', 'governance.steward', 'eval.intentsFile']),
    );
    expect(r.next).toMatch(/steward/);
  });

  it('writes: scaffolds a complete writeSafety skeleton with a real dry-run and a reversal class', () => {
    const r = ok({ id: 'jde.ap.supplier_note.create', server: 'jde-fin-ap', write: true, bindingType: 'function' });
    const ws = (parseYaml(r.yaml) as { writeSafety: Record<string, Record<string, unknown>> }).writeSafety;
    expect(ws['dryRun']?.['strategy']).toBe('validate-pair');
    expect(ws['dryRun']?.['strategy']).not.toBe('none');
    expect(ws['confirm']?.['required']).toBe(true);
    expect(ws['reversal']?.['class']).toBe('compensating-tool');
    expect(ws['idempotency']).toBeDefined();
    expect(r.humanFields).toEqual(
      expect.arrayContaining(['writeSafety.confirm.planTemplate', 'writeSafety.reversal.tool']),
    );
  });

  it.each(BINDING_TYPES)('%s: never writes identity.carries: verified', (bindingType) => {
    const write = bindingType !== 'database';
    const r = ok({ id: 'jde.ap.supplier_note.create', bindingType, write });
    expect(r.yaml).not.toMatch(/carries:\s*verified/);
    expect((parseYaml(r.yaml) as { binding: { type: string } }).binding.type).toBe(bindingType);
    expect(r.yaml).toMatch(/reviewPath: standard/);
  });

  it('refuses a database write and says what to do instead', () => {
    const r = scaffoldTool({ id: 'jde.ap.supplier_note.create', bindingType: 'database', write: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.next).toMatch(/plsql/);
  });

  it('refuses a write on a read verb, a bad id and an off-list verb, each with a next', () => {
    for (const a of [
      { id: 'jde.ap.supplier_note.get', write: true },
      { id: 'jde.ap.supplier_note' },
      { id: 'jde.ap.supplier_note.fetch' },
    ]) {
      const r = scaffoldTool(a);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.next.length).toBeGreaterThan(0);
    }
  });

  it('precondition-read on a financial tool forces human approval (02 §3.5)', () => {
    const r = ok({ id: 'jde.ap.supplier_note.create', bindingType: 'wrapped-vendor', write: true, sensitivity: 'financial' });
    expect((parseYaml(r.yaml) as { writeSafety: { humanApprovalRequired: boolean } }).writeSafety.humanApprovalRequired).toBe(true);
  });

  it.each([
    ['read', { id: 'jde.ap.supplier_note.get', server: 'jde-fin-ap' }],
    ['write', { id: 'jde.ap.supplier_note.create', server: 'jde-fin-ap', write: true, bindingType: 'function' as const }],
  ])('%s scaffold fails forge validate only on fields a human must supply', (_n, answers) => {
    const r = ok(answers);
    const root = scratchRepo();
    const target = join(root, r.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, r.yaml, 'utf8');
    const report = validateRepo(root);
    const own = report.failures.filter((f) => f.file.endsWith(`${r.id.split('.').slice(2).join('.')}.tool.yaml`));
    expect(own.length).toBeGreaterThan(0); // the placeholders really are caught
    const stray = report.failures
      .filter((f) => f.file.endsWith(`${r.id.split('.').slice(2).join('.')}.tool.yaml`))
      .filter((f) => !r.humanFields.some((h) => dotted(f.path) === h || dotted(f.path).startsWith(`${h}.`) || h.startsWith(dotted(f.path))))
      .map((f) => `${f.ruleId} ${f.path}`);
    expect(stray).toEqual([]);
  });
});

describe('forge new tool (command)', () => {
  let root: string;
  let out: string;
  beforeEach(() => {
    root = scratchRepo();
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      out += String(c);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('stages the manifest under .mcpforge/proposals and never writes manifests/', () => {
    const code = runNewToolCommand({ json: true, id: 'jde.ap.supplier_note.create', write: true, bindingType: 'plsql', server: 'jde-fin-ap', root });
    expect(code).toBe(0);
    const payload = JSON.parse(out) as { staged: string; target: string; humanFields: string[]; next: string };
    expect(existsSync(payload.staged)).toBe(true);
    expect(existsSync(join(root, payload.target))).toBe(false);
    expect(readFileSync(payload.staged, 'utf8')).toMatch(/kind: Tool/);
    expect(payload.humanFields.length).toBeGreaterThan(0);
    expect(payload.next.length).toBeGreaterThan(0);
  });

  it('takes answers from a file, with flags winning', () => {
    const file = join(root, 'answers.yaml');
    writeFileSync(file, 'id: jde.ap.supplier_note.get\nserver: jde-fin-ap\nowner: AP team\n');
    expect(runNewToolCommand({ json: true, answers: file, owner: 'Finance CoE', root })).toBe(0);
    const payload = JSON.parse(out) as { staged: string };
    expect(readFileSync(payload.staged, 'utf8')).toMatch(/owner: Finance CoE/);
  });

  it('fails with a next when the id is missing or the manifest exists', () => {
    expect(runNewToolCommand({ json: true, root })).toBe(64);
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'INPUT_INVALID' });
    out = '';
    mkdirSync(join(root, 'manifests', 'jde', 'ap'), { recursive: true });
    writeFileSync(join(root, 'manifests', 'jde', 'ap', 'voucher.get.tool.yaml'), 'x');
    expect(runNewToolCommand({ json: true, id: 'jde.ap.voucher.get', root })).toBe(64);
    expect((JSON.parse(out) as { next: string }).next.length).toBeGreaterThan(0);
  });
});
