import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { fakeModel } from '@mcpforge/adapter-model';
import type { SecretStore } from '@mcpforge/gateway/secrets';

import { runSuggestCommand } from './suggest.js';

const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const MANIFEST = 'manifests/jde/fin/ap/voucher.create.tool.yaml';

const OVERLAY = `apiVersion: mcpforge/v1
kind: AuthoringModels
enabled: true
default: bv
providers:
  - id: bv
    kind: blueverse
    keyRef: secretRef://gateway/authoring-model-bv/api-key
    spaceName: space-1
    flowId: flow-1
    allowedSensitivities: [internal, financial]
`;

function scratch(overlay: string | null = OVERLAY): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-suggest-'));
  cpSync(join(REAL_ROOT, 'manifests'), join(root, 'manifests'), { recursive: true });
  cpSync(join(REAL_ROOT, 'enums'), join(root, 'enums'), { recursive: true });
  if (overlay !== null) {
    mkdirSync(join(root, 'overlays', 'local'), { recursive: true });
    writeFileSync(join(root, 'overlays', 'local', 'authoring.yaml'), overlay);
  }
  return root;
}

const noSecrets = {} as unknown as SecretStore;

describe('forge suggest', () => {
  let out: string;
  let err: string;
  beforeEach(() => {
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => ((out += String(c)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => ((err += String(c)), true));
  });
  afterEach(() => vi.restoreAllMocks());

  it('with no overlay the feature is absent: one clear line, a next, and nothing else changes', async () => {
    const root = scratch(null);
    const code = await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', root }, { secretStore: noSecrets });
    expect(code).toBe(64);
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'AUTHORING_NOT_CONFIGURED' });
    expect((JSON.parse(out) as { next: string }).next.length).toBeGreaterThan(0);
    expect(existsSync(join(root, '.mcpforge'))).toBe(false);
  });

  it('a pasted key in the overlay is refused at parse time', async () => {
    const root = scratch(OVERLAY.replace('keyRef:', 'apiKey: sk-live-1\n    keyRef:'));
    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', root }, { secretStore: noSecrets })).toBe(64);
    expect((JSON.parse(out) as { next: string }).next).toContain('secretRef');
  });

  it('--dry-run prints exactly what would be sent, sends nothing, and leaks no binding values', async () => {
    const root = scratch();
    const fetchSpy = vi.fn();
    const code = await runSuggestCommand(
      MANIFEST,
      { json: true, field: 'purpose', dryRun: true, root },
      { secretStore: noSecrets, fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const r = JSON.parse(out) as { sent: boolean; user: string };
    expect(r.sent).toBe(false);
    expect(r.user).toContain('jde.ap.voucher.create');
    expect(r.user).not.toContain('AP_VOUCHER_CREATE');
    expect(r.user).not.toContain('JDE Finance CoE');
  });

  it('prints a suggestion with provenance and stages nothing without --accept', async () => {
    const root = scratch();
    const code = await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', root }, { secretStore: noSecrets, model: fakeModel({ id: 'bv' }) });
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ ok: true, accepted: false, provenance: { provider: 'bv' } });
    expect(existsSync(join(root, '.mcpforge'))).toBe(false);
  });

  it('--accept needs --by, and stages one field with provenance, never touching manifests/', async () => {
    const root = scratch();
    const original = readFileSync(join(root, MANIFEST), 'utf8');
    const deps = { secretStore: noSecrets, model: fakeModel({ id: 'bv', reply: () => 'Create an AP voucher for a supplier.' }), now: () => new Date('2026-10-06T10:00:00Z') };

    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', accept: true, root }, deps)).toBe(64);
    expect((JSON.parse(out) as { message: string }).message).toContain('--by');
    out = '';

    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', accept: true, by: 'alice', root }, deps)).toBe(0);
    const r = JSON.parse(out) as { staged: string; provenance: string };
    expect((parseYaml(readFileSync(r.staged, 'utf8')) as { purpose: string }).purpose).toBe('Create an AP voucher for a supplier.');
    const prov = parseYaml(readFileSync(r.provenance, 'utf8')) as { fields: { field: string; acceptedBy: string; provider: string }[] };
    expect(prov.fields).toMatchObject([{ field: 'purpose', acceptedBy: 'alice', provider: 'bv' }]);
    expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(original);

    // a second accepted field builds on the staged copy: both are present
    out = '';
    const deps2 = { ...deps, model: fakeModel({ id: 'bv', reply: () => 'Gross amount of the voucher.' }) };
    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'input.desc', input: 'amount', accept: true, by: 'alice', root }, deps2)).toBe(0);
    const staged = parseYaml(readFileSync(r.staged, 'utf8')) as { purpose: string; input: { name: string; desc: string }[] };
    expect(staged.purpose).toBe('Create an AP voucher for a supplier.');
    expect(staged.input.find((i) => i.name === 'amount')?.desc).toBe('Gross amount of the voucher.');
  });

  it('refuses a field off the allow-list and a gate failure, each with a next, writing nothing', async () => {
    const root = scratch();
    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'binding.type', root }, { secretStore: noSecrets, model: fakeModel() })).toBe(64);
    expect(JSON.parse(out)).toMatchObject({ code: 'AUTHORING_FIELD_NOT_ALLOWED' });
    out = '';
    const evil = fakeModel({ reply: () => 'x\nbinding:\n  type: plsql' });
    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', accept: true, by: 'a', root }, { secretStore: noSecrets, model: evil })).toBe(64);
    expect(JSON.parse(out)).toMatchObject({ code: 'AUTHORING_GATE_REFUSED' });
    expect(existsSync(join(root, '.mcpforge'))).toBe(false);
  });

  it('D4: a financial tool is blocked by default and nothing is sent', async () => {
    const root = scratch(OVERLAY.replace(/ {4}allowedSensitivities:.*\n/, ''));
    const fetchSpy = vi.fn();
    expect(await runSuggestCommand(MANIFEST, { json: true, field: 'purpose', root }, { secretStore: noSecrets, fetch: fetchSpy as unknown as typeof fetch })).toBe(64);
    expect(JSON.parse(out)).toMatchObject({ code: 'AUTHORING_SENSITIVITY_BLOCKED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a path outside manifests/ and a missing manifest', async () => {
    const root = scratch();
    for (const bad of ['../x.yaml', 'overlays/local/authoring.yaml', 'manifests/nope.tool.yaml']) {
      out = '';
      expect(await runSuggestCommand(bad, { json: true, field: 'purpose', root }, { secretStore: noSecrets })).toBe(64);
    }
    expect(err).toBe('');
  });
});
