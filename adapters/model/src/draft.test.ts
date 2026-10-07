// W0-Q9b: the definitions-root reads lifted out of `forge suggest` so the CLI and
// the gateway's authoring endpoints share them.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ALLOWED_FIELDS, UNCONFIGURED, loadAuthoringConfig, siblingsOf } from './index.js';
import { AUTHORING_ALLOWED_FIELDS } from '@mcpforge/shared/api/v1';

const roots: string[] = [];
function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'forge-model-draft-'));
  roots.push(r);
  return r;
}
function put(r: string, rel: string, text: string): void {
  mkdirSync(join(r, rel, '..'), { recursive: true });
  writeFileSync(join(r, rel), text);
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('loadAuthoringConfig', () => {
  it('is the feature-absent config when there is no overlay file', () => {
    expect(loadAuthoringConfig(root(), 'local')).toEqual({ ok: true, config: UNCONFIGURED });
  });

  it('refuses a pasted key with a next, and parses a valid overlay', () => {
    const r = root();
    const overlay = `apiVersion: mcpforge/v1
kind: AuthoringModels
enabled: true
providers:
  - id: bv
    kind: blueverse
    keyRef: secretRef://gateway/authoring-model-bv/api-key
`;
    put(
      r,
      'overlays/local/authoring.yaml',
      overlay.replace('keyRef:', 'apiKey: sk-1\n    keyRef:'),
    );
    const bad = loadAuthoringConfig(r, 'local');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.next.length).toBeGreaterThan(0);
    put(r, 'overlays/local/authoring.yaml', overlay);
    const good = loadAuthoringConfig(r, 'local');
    expect(good.ok && good.config.providers.map((p) => p.id)).toEqual(['bv']);
    // Another deployment's overlay is not this one.
    expect(loadAuthoringConfig(r, 'other')).toEqual({ ok: true, config: UNCONFIGURED });
  });
});

describe('siblingsOf', () => {
  it('lists the other tools sharing {app}.{module}.{entity}, never the draft itself', () => {
    const r = root();
    const tool = (id: string, entity: string, purpose: string): string =>
      `apiVersion: mcpforge/v1\nkind: Tool\nid: ${id}\napp: jde\nmodule: ap\nentity: ${entity}\npurpose: ${purpose}\n`;
    put(
      r,
      'manifests/jde/ap/voucher.get.tool.yaml',
      tool('jde.ap.voucher.get', 'voucher', 'Get one voucher.'),
    );
    put(
      r,
      'manifests/jde/ap/voucher.create.tool.yaml',
      tool('jde.ap.voucher.create', 'voucher', 'Create a voucher.'),
    );
    put(
      r,
      'manifests/jde/ap/supplier.get.tool.yaml',
      tool('jde.ap.supplier.get', 'supplier', 'Get a supplier.'),
    );
    const doc = { id: 'jde.ap.voucher.create', app: 'jde', module: 'ap', entity: 'voucher' };
    expect(siblingsOf(r, doc)).toEqual([{ id: 'jde.ap.voucher.get', purpose: 'Get one voucher.' }]);
  });
});

describe('the allow-list has one home', () => {
  it('ALLOWED_FIELDS is the shared constant, not a copy', () => {
    expect(ALLOWED_FIELDS).toBe(AUTHORING_ALLOWED_FIELDS);
  });
});
