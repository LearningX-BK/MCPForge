// W0-Q9: the portal's authoring server actions. The viewer and the secret store are
// the only mocks (a unit test has no request cookie and no OS keychain); the
// overlay, the gate, `applySuggestion` and the provenance are real.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { SecretValue } from '@mcpforge/gateway/secrets';

const viewerState: { current: { subject: string } | null } = { current: null };
vi.mock('@/lib/viewer/session', () => ({ getViewer: () => Promise.resolve(viewerState.current) }));

const keys = new Set<string>();
vi.mock('@mcpforge/gateway/secrets/server', () => ({
  EncryptedFileStore: class {
    kind = 'encrypted-file';
    async metadata(ref: { uri: string }) {
      if (!keys.has(ref.uri)) throw new Error('missing');
      return { ref: ref.uri, version: 1, createdAt: 'x', rotatedAt: undefined, expiresAt: undefined };
    }
    async get(ref: { uri: string }) {
      if (!keys.has(ref.uri)) throw new Error('missing');
      return new SecretValue(ref as never, 1, 'KEY');
    }
  },
}));

import { authoringAccept, authoringPreview, authoringStatus } from './actions';

const OVERLAY = `apiVersion: mcpforge/v1
kind: AuthoringModels
enabled: true
default: bv
providers:
  - id: bv
    kind: blueverse
    keyRef: secretRef://gateway/authoring-model-bv/api-key
    spaceName: s
    flowId: f
`;
const DRAFT = `id: jde.ap.supplier.create
app: jde
module: ap
entity: supplier
verb: create
sensitivity: internal
purpose: Old purpose here.
binding: { type: function, ref: KEEP_ME }
governance: { reviewPath: standard, steward: bob }
`;
const PROV = { provider: 'bv', model: 'flow:f', requestId: 'r1' };

let root: string;
function put(rel: string, text: string): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'forge-authoring-actions-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  process.env['MCPFORGE_PORTAL_REPO_ROOT'] = root;
});
afterAll(() => {
  delete process.env['MCPFORGE_PORTAL_REPO_ROOT'];
});
beforeEach(() => {
  viewerState.current = { subject: 'local:alice' };
  keys.clear();
});

describe('authoringStatus: absent, not broken', () => {
  it('is off with no overlay', async () => {
    expect(await authoringStatus()).toEqual({ enabled: false, providers: [], defaultProvider: null });
  });

  it('is off, not half-on, when the overlay is broken or carries a pasted key', async () => {
    put('overlays/local/authoring.yaml', OVERLAY.replace('keyRef:', 'apiKey: sk-1\n    keyRef:'));
    expect((await authoringStatus()).enabled).toBe(false);
  });

  it('reports whether each provider has a key, without reading it', async () => {
    put('overlays/local/authoring.yaml', OVERLAY);
    expect((await authoringStatus()).providers).toEqual([{ id: 'bv', kind: 'blueverse', available: false }]);
    keys.add('secretRef://gateway/authoring-model-bv/api-key');
    const s = await authoringStatus();
    expect(s).toMatchObject({ enabled: true, defaultProvider: 'bv', providers: [{ id: 'bv', available: true }] });
    expect(JSON.stringify(s)).not.toContain('KEY');
  });
});

describe('authoringAccept: one field, stamped by the session', () => {
  beforeEach(() => put('overlays/local/authoring.yaml', OVERLAY));

  it('refuses when nobody is signed in', async () => {
    viewerState.current = null;
    const r = await authoringAccept({ yaml: DRAFT, field: 'purpose', text: 'Create a supplier.', provenance: PROV });
    expect(r).toMatchObject({ ok: false, code: 'CHANGE_SIGN_IN_REQUIRED' });
  });

  it('applies exactly one field and records the SIGNED-IN subject, whatever the caller sends', async () => {
    const r = await authoringAccept({
      yaml: DRAFT,
      field: 'purpose',
      text: 'Create a supplier record.',
      provenance: PROV,
      acceptedBy: 'mallory',
    } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = parseYaml(r.yaml) as { purpose: string; binding: { ref: string }; governance: { steward: string } };
    expect(doc.purpose).toBe('Create a supplier record.');
    expect(doc.binding.ref).toBe('KEEP_ME');
    expect(doc.governance.steward).toBe('bob');
    expect(r.provenancePath).toBe('provenance/jde.ap.supplier.create.authoring.yaml');
    expect(r.provenanceYaml).toContain('acceptedBy: local:alice');
    expect(r.provenanceYaml).not.toContain('mallory');
    expect(r.provenanceYaml).not.toContain('KEY');
  });

  it('refuses a field off the allow-list, text that is not one value, and an unconfigured provider', async () => {
    const off = await authoringAccept({ yaml: DRAFT, field: 'binding.ref', text: 'EVIL', provenance: PROV });
    expect(off).toMatchObject({ ok: false });
    const multi = await authoringAccept({ yaml: DRAFT, field: 'purpose', text: 'x\nbinding:\n  type: plsql', provenance: PROV });
    expect(multi).toMatchObject({ ok: false, code: 'AUTHORING_GATE_REFUSED' });
    const stranger = await authoringAccept({ yaml: DRAFT, field: 'purpose', text: 'Create it.', provenance: { ...PROV, provider: 'nobody' } });
    expect(stranger).toMatchObject({ ok: false, code: 'AUTHORING_PROVIDER_UNKNOWN' });
  });
});

describe('authoringPreview', () => {
  it('needs a signed-in viewer, and shows the payload without any binding value', async () => {
    put('overlays/local/authoring.yaml', OVERLAY);
    viewerState.current = null;
    expect(await authoringPreview({ yaml: DRAFT, field: 'purpose' })).toMatchObject({ ok: false });
    viewerState.current = { subject: 'local:alice' };
    const r = await authoringPreview({ yaml: DRAFT, field: 'purpose' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user).toContain('jde.ap.supplier.create');
      expect(r.user).not.toContain('KEEP_ME');
    }
  });
});
