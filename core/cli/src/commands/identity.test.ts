// MCPForge — `forge identity remap`, W0-D4, end to end.
//
// Same two-layer shape as audit.test.ts: the command function against an
// isolated temp mappings root, and the real `forge` binary spawned as a
// child process to prove the program.ts wiring and the --json contract.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatIdentityRemapReportHuman,
  runIdentityRemap,
  runIdentityRemapCommand,
} from './identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(here, '..', '..', 'bin', 'forge.js');

let root: string;

function writeMapping(deployment: string, body: string): string {
  const dir = path.join(root, deployment, 'mappings');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'groups-to-roles.yaml');
  writeFileSync(file, body, 'utf-8');
  return file;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mcpforge-identity-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const MAPPING = `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  finance-ap-clerks:
    roles: [p2p-ap-clerk]
subjectOverrides:
  local:jdoe:
    roles: [p2p-admin]
`;

function capture(run: () => number): { out: string; code: number } {
  const original = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = run();
    return { out, code };
  } finally {
    process.stdout.write = original;
  }
}

describe('runIdentityRemap', () => {
  it('rewrites the mapping file and returns every changed row', () => {
    writeMapping('local', MAPPING);
    const report = runIdentityRemap('local:jdoe', 'oidc:jdoe@corp.example.com', root);
    expect(report.ok).toBe(true);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]?.roles).toEqual(['p2p-admin']);
  });
});

describe('formatIdentityRemapReportHuman', () => {
  it('says plainly when nothing matched', () => {
    const text = formatIdentityRemapReportHuman({
      ok: true,
      fromSubject: 'local:nobody',
      toSubject: 'oidc:nobody',
      mappingsRoot: root,
      changed: [],
      errors: [],
    });
    expect(text).toContain('nothing to change');
  });
});

describe('runIdentityRemapCommand', () => {
  it('exits 64 with INPUT_INVALID when --from/--to are missing', () => {
    const { out, code } = capture(() =>
      runIdentityRemapCommand({ json: true, mappingsRoot: root }),
    );
    expect(code).toBe(64);
    const parsed = JSON.parse(out) as { code: string; next: string };
    expect(parsed.code).toBe('INPUT_INVALID');
    expect(parsed.next.length).toBeGreaterThan(0);
  });

  it('exits 64 when --from and --to are identical', () => {
    const { code } = capture(() =>
      runIdentityRemapCommand({ json: true, from: 'x', to: 'x', mappingsRoot: root }),
    );
    expect(code).toBe(64);
  });

  it('exits 0 and emits a parseable JSON report on success', () => {
    writeMapping('local', MAPPING);
    const { out, code } = capture(() =>
      runIdentityRemapCommand({
        json: true,
        from: 'local:jdoe',
        to: 'oidc:jdoe@corp.example.com',
        mappingsRoot: root,
      }),
    );
    expect(code).toBe(0);
    const report = JSON.parse(out) as { ok: boolean; changed: unknown[] };
    expect(report.ok).toBe(true);
    expect(report.changed).toHaveLength(1);
  });

  it('exits 1 when a mapping file under the root fails to parse', () => {
    writeMapping('local', MAPPING);
    writeMapping('broken', '{ not valid');
    const { code } = capture(() =>
      runIdentityRemapCommand({
        json: true,
        from: 'local:jdoe',
        to: 'oidc:jdoe',
        mappingsRoot: root,
      }),
    );
    expect(code).toBe(1);
  });
});

describe('forge identity remap (spawned binary)', () => {
  it('wires through program.ts end to end', () => {
    writeMapping('local', MAPPING);
    const result = spawnSync(
      process.execPath,
      [
        binPath,
        'identity',
        'remap',
        '--from',
        'local:jdoe',
        '--to',
        'oidc:jdoe@corp.example.com',
        '--mappings-root',
        root,
        '--json',
      ],
      { encoding: 'utf-8', cwd: path.join(here, '..', '..') },
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as { ok: boolean; changed: { toSubject: string }[] };
    expect(report.ok).toBe(true);
    expect(report.changed[0]?.toSubject).toBe('oidc:jdoe@corp.example.com');

    const after = readFileSync(
      path.join(root, 'local', 'mappings', 'groups-to-roles.yaml'),
      'utf-8',
    );
    expect(after).toContain('oidc:jdoe@corp.example.com');
  });
});
