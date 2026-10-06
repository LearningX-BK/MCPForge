// MCPForge — W0-Q5b: `forge validate` over `requests/<id>.request.yaml`.
// Each repo is built in a temp dir so no secret-shaped fixture is committed.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateRepo } from '../validate/engine.js';
import { loadManifestFiles, loadRequestFiles } from '../validate/loader.js';
import type { ValidationFailure } from '../validate/types.js';
import { POLICY_RULES, REQUEST_RULES } from './index.js';

const ID = 'req-20261006-search-ap-vouchers';

function good(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 'mcpforge/v1',
    kind: 'Request',
    id: ID,
    requestedBy: 'local:7f9d3c2e-1b4a-4c8e-9a51-2d6f0e8b7c31',
    requestedAt: '2026-10-06T10:00:00.000Z',
    ask: 'search AP vouchers for a supplier by amount',
    business: {
      does: 'find vouchers by amount',
      app: 'jde',
      module: 'ap',
      access: 'read',
      inputs: ['supplier_number', 'amount_from'],
      goodAnswer: 'a list of vouchers',
      whoMayRun: 'AP clerks',
    },
    verdictAtSubmit: {
      tier: 'near_miss',
      indexDigest: `sha256:${'0123456789abcdef'.repeat(4)}`,
      matches: [{ toolId: 'jde.ap.voucher.search', score: 11.3 }],
      decision: { kind: 'justify', text: 'needs an amount range' },
    },
    governance: {
      owner: 'JDE Finance CoE',
      steward: 'bob',
      sensitivity: 'financial',
      processTag: 'P2P',
      expectedVolume: '~200/day',
      intendedToolId: 'jde.ap.voucher_by_amount.search',
      server: 'jde-fin-ap',
    },
    ...over,
  };
}

/** A temp repo with the given files (path -> YAML doc or raw text). */
function repo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-req-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === 'string' ? content : stringify(content));
  }
  return root;
}

function failures(root: string): readonly ValidationFailure[] {
  return validateRepo(root).failures;
}

function firedBy(root: string, ruleId: string): readonly ValidationFailure[] {
  return failures(root).filter((f) => f.ruleId === ruleId);
}

function expectFires(root: string, ruleId: string, path: string): ValidationFailure {
  const hits = firedBy(root, ruleId);
  expect(hits.length, `${ruleId} did not fire`).toBeGreaterThan(0);
  const hit = hits.find((f) => f.path === path);
  expect(hit, `${ruleId} fired, but not at ${path}: ${JSON.stringify(hits)}`).toBeDefined();
  expect(hit!.fix.trim().length).toBeGreaterThan(0);
  expect(hit!.fix).not.toMatch(/^try again/i);
  return hit!;
}

const at = (id = ID): string => `requests/${id}.request.yaml`;

describe('request rules — wiring', () => {
  it('run by default in forge validate (POLICY_RULES), not opt-in', () => {
    for (const r of REQUEST_RULES) expect(POLICY_RULES).toContain(r);
  });

  it('a well-formed request passes every rule; a repo with no requests/ is untouched', () => {
    expect(failures(repo({ [at()]: good() }))).toEqual([]);
    expect(failures(repo({}))).toEqual([]);
    // Closed declined/withdrawn are the stored states that ARE allowed.
    const closed = good({
      closed: { state: 'withdrawn', by: 'local:x', at: '2026-10-07T00:00:00Z', reason: 'dup' },
    });
    expect(failures(repo({ [at()]: closed }))).toEqual([]);
  });

  it('requests are loaded separately: loadManifestFiles never returns them', () => {
    const root = repo({ [at()]: good() });
    expect(loadManifestFiles(root)).toEqual([]);
    expect(loadRequestFiles(root).map((f) => f.file)).toEqual([at()]);
  });
});

describe('request rules — negative cases fail closed', () => {
  it('request.shape: YAML that does not parse', () => {
    expectFires(repo({ [at()]: 'id: [unclosed\n' }), 'request.shape', '');
  });

  it('request.shape: a schema violation names the field', () => {
    const doc = good();
    (doc['business'] as Record<string, unknown>)['access'] = 'admin';
    expectFires(repo({ [at()]: doc }), 'request.shape', '/business/access');
  });

  it('request.shape: a Tool manifest dropped into requests/ is not a Request', () => {
    expectFires(
      repo({ [at()]: { apiVersion: 'mcpforge/v1', kind: 'Tool', id: ID } }),
      'request.shape',
      '/kind',
    );
  });

  it('request.unknown-field: an undeclared key, top-level and nested', () => {
    const doc = good({ priority: 'high' });
    (doc['governance'] as Record<string, unknown>)['draftBranch'] = 'main';
    const root = repo({ [at()]: doc });
    expectFires(root, 'request.unknown-field', '/priority');
    expectFires(root, 'request.unknown-field', '/governance/draftBranch');
  });

  it('request.unknown-field: extra keys on a union member are caught', () => {
    const doc = good();
    (doc['verdictAtSubmit'] as Record<string, unknown>)['decision'] = {
      kind: 'merge',
      into: 'jde.ap.voucher.search',
      text: 'smuggled',
    };
    expectFires(repo({ [at()]: doc }), 'request.unknown-field', '/verdictAtSubmit/decision/text');
  });

  it('request.file-name: file name does not match id', () => {
    expectFires(
      repo({ 'requests/req-20261006-other.request.yaml': good() }),
      'request.file-name',
      '/id',
    );
  });

  it('request.file-name: nested under a subdirectory or wrong extension', () => {
    expectFires(repo({ [`requests/sub/${ID}.request.yaml`]: good() }), 'request.file-name', '/id');
    expectFires(repo({ [`requests/${ID}.yaml`]: good() }), 'request.file-name', '/id');
  });

  it('request.requested-by: missing, blank, or non-string', () => {
    const missing = good();
    delete missing['requestedBy'];
    expectFires(repo({ [at()]: missing }), 'request.requested-by', '/requestedBy');
    expectFires(
      repo({ [at()]: good({ requestedBy: '   ' }) }),
      'request.requested-by',
      '/requestedBy',
    );
    expectFires(
      repo({ [at()]: good({ requestedBy: 42 }) }),
      'request.requested-by',
      '/requestedBy',
    );
  });

  it('request.secret-content: a secretRef, a credential-named key, a PEM block, a JWT, a high-entropy string, URL userinfo', () => {
    const doc = good({ apiKey: 'whatever' });
    const business = doc['business'] as Record<string, unknown>;
    business['does'] = 'use secretRef://binding/ebs-p2p-ap/wrapper-schema to read vouchers';
    business['goodAnswer'] = `-----BEGIN ${'PRIVATE'} KEY----- abc`;
    business['whoMayRun'] = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig';
    business['inputs'] = [
      'Zx8Qw2Lr7Vb4Np1Ks6Ty3Hm9Gd5Fc0JaUeXoYiPq',
      'https://scott:tiger@ebs.example/x',
    ];
    const root = repo({ [at()]: doc });
    expectFires(root, 'request.secret-content', '/apiKey');
    expectFires(root, 'request.secret-content', '/business/does');
    expectFires(root, 'request.secret-content', '/business/goodAnswer');
    expectFires(root, 'request.secret-content', '/business/whoMayRun');
    expectFires(root, 'request.secret-content', '/business/inputs/0');
    expectFires(root, 'request.secret-content', '/business/inputs/1');
    // The message never echoes the value it found.
    for (const f of firedBy(root, 'request.secret-content')) {
      expect(f.message).not.toContain('Zx8Qw2Lr7Vb4Np1Ks6Ty3Hm9Gd5Fc0JaUeXoYiPq');
      expect(f.message).not.toContain('tiger');
    }
  });

  it('request.secret-content: still fires when the file also fails the schema', () => {
    expectFires(
      repo({ [at()]: { kind: 'Request', password: 'hunter2' } }),
      'request.secret-content',
      '/password',
    );
  });

  it('request.secret-content: the hex index digest is not mistaken for a secret', () => {
    expect(firedBy(repo({ [at()]: good() }), 'request.secret-content')).toEqual([]);
  });

  it('request.calls-field: anywhere in the document', () => {
    const doc = good({ calls: 1200 });
    (doc['business'] as Record<string, unknown>)['calls'] = 5;
    const root = repo({ [at()]: doc });
    expectFires(root, 'request.calls-field', '/calls');
    expectFires(root, 'request.calls-field', '/business/calls');
  });

  it('request.duplicate-id: two files declaring one id both fail', () => {
    const root = repo({ [at()]: good(), [`requests/copy/${ID}.request.yaml`]: good() });
    const hits = firedBy(root, 'request.duplicate-id');
    expect(hits.map((h) => h.file).sort()).toEqual([`requests/copy/${ID}.request.yaml`, at()]);
  });

  it('request.tool-id: a verb outside the closed list, a malformed match and merge target', () => {
    const doc = good();
    (doc['governance'] as Record<string, unknown>)['intendedToolId'] =
      'jde.ap.voucher.search_by_amount';
    const verdict = doc['verdictAtSubmit'] as Record<string, unknown>;
    verdict['matches'] = [{ toolId: 'JDE.AP.Voucher.Search', score: 1 }];
    verdict['decision'] = { kind: 'merge', into: 'jde.ap.voucher' };
    const root = repo({ [at()]: doc });
    expectFires(root, 'request.tool-id', '/governance/intendedToolId');
    expectFires(root, 'request.tool-id', '/verdictAtSubmit/matches/0/toolId');
    expectFires(root, 'request.tool-id', '/verdictAtSubmit/decision/into');
  });

  it('request.stored-state: a stored derived status, or a closed state other than declined/withdrawn', () => {
    expectFires(repo({ [at()]: good({ status: 'merged' }) }), 'request.stored-state', '/status');
    expectFires(
      repo({
        [at()]: good({ closed: { state: 'enabled', by: 'local:x', at: 'now', reason: 'r' } }),
      }),
      'request.stored-state',
      '/closed/state',
    );
  });

  it('every request rule is exercised by a negative case in this file', () => {
    const exercised = new Set([
      'request.shape',
      'request.unknown-field',
      'request.file-name',
      'request.requested-by',
      'request.secret-content',
      'request.calls-field',
      'request.duplicate-id',
      'request.tool-id',
      'request.stored-state',
    ]);
    expect(new Set(REQUEST_RULES.map((r) => r.id))).toEqual(exercised);
  });

  it('every request finding fails the build (none is a warning)', () => {
    const root = repo({ [at()]: good({ status: 'merged', calls: 1 }) });
    const report = validateRepo(root);
    expect(report.ok).toBe(false);
    expect(report.warnings.filter((w) => w.ruleId.startsWith('request.'))).toEqual([]);
  });
});
