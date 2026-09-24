import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkForLeakedSecrets,
  checkOverlayFileTypes,
  runOverlayPurityCheck,
} from './overlay-purity.js';

let repoRoot: string;

afterEach(() => {
  if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
});

function makeRepoRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'mcpforge-overlay-purity-'));
}

function writeFile(repo: string, relPath: string, content: string): void {
  const abs = path.join(repo, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe('checkOverlayFileTypes', () => {
  it('passes a clean overlay with only config, mappings and a secretRef', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'overlays/local/caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: local\ncaps:\n  rowCap: 500\n',
    );
    writeFile(
      repoRoot,
      'overlays/local/mappings/groups-to-roles.yaml',
      [
        'apiVersion: mcpforge/v1',
        'kind: GroupRoleMapping',
        'deployment: local',
        'groups:',
        '  finance-ap-clerks:',
        '    roles:',
        '      - p2p-ap-clerk',
        'subjectOverrides: {}',
      ].join('\n'),
    );
    expect(checkOverlayFileTypes(repoRoot)).toEqual([]);
  });

  it('fails on a .ts file under overlays/**, naming the file', () => {
    repoRoot = makeRepoRoot();
    writeFile(repoRoot, 'overlays/acme/hack.ts', 'export const x = 1;\n');
    const violations = checkOverlayFileTypes(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('overlays/acme/hack.ts');
  });

  it('fails on a .py and a .sql file under overlays/**', () => {
    repoRoot = makeRepoRoot();
    writeFile(repoRoot, 'overlays/acme/script.py', 'print(1)\n');
    writeFile(repoRoot, 'overlays/acme/migration.sql', 'SELECT 1;\n');
    const violations = checkOverlayFileTypes(repoRoot);
    expect(violations.map((v) => v.file).sort()).toEqual([
      'overlays/acme/migration.sql',
      'overlays/acme/script.py',
    ]);
  });

  it('fails on a YAML file carrying kind: Tool, Server, Role or Package', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'overlays/acme/sneaky-tool.yaml',
      'apiVersion: mcpforge/v1\nkind: Tool\nid: acme.custom.thing.create\n',
    );
    const violations = checkOverlayFileTypes(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('overlays/acme/sneaky-tool.yaml');
    expect(violations[0]!.message).toContain('kind: Tool');
  });

  it('fails a fixture overlay setting an undeclared key on a Caps overlay', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'overlays/acme/caps.yaml',
      'apiVersion: mcpforge/v1\nkind: Caps\ndeployment: acme\ncaps:\n  rowCap: 500\n  bogusUndeclaredCap: 9\n',
    );
    const violations = checkOverlayFileTypes(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('bogusUndeclaredCap');
  });

  it('fails a fixture overlay setting an undeclared top-level key on a GroupRoleMapping overlay', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'overlays/acme/mappings/groups-to-roles.yaml',
      [
        'apiVersion: mcpforge/v1',
        'kind: GroupRoleMapping',
        'deployment: acme',
        'groups: {}',
        'notARealField: true',
      ].join('\n'),
    );
    const violations = checkOverlayFileTypes(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('notARealField');
  });

  it('returns no violations when overlays/ does not exist', () => {
    repoRoot = makeRepoRoot();
    expect(checkOverlayFileTypes(repoRoot)).toEqual([]);
  });
});

describe('checkForLeakedSecrets', () => {
  it('passes a file whose secret-shaped key carries a secretRef:// URI', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'overlays/local/secrets.ref',
      'secret: secretRef://binding/ebs-p2p-ap/wrapper-schema\n',
    );
    expect(checkForLeakedSecrets(repoRoot)).toEqual([]);
  });

  it('fails, naming the file and line, on a literal password: value', () => {
    repoRoot = makeRepoRoot();
    writeFile(repoRoot, 'overlays/local/config.yaml', 'apiVersion: mcpforge/v1\npassword: hunter2\n');
    const violations = checkForLeakedSecrets(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('overlays/local/config.yaml');
    expect(violations[0]!.line).toBe(2);
  });

  it('fails on a literal token: and a literal key: value on separate lines', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'manifests/jde/fin/ap/leaky.tool.yaml',
      'apiVersion: mcpforge/v1\ntoken: abc123literal\nkey: anotherliteral\n',
    );
    const violations = checkForLeakedSecrets(repoRoot);
    expect(violations.map((v) => v.line)).toEqual([2, 3]);
  });

  it('fails on a PEM header, naming the file and line', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'consumers/acme-agent.yaml',
      'apiVersion: mcpforge/v1\n-----BEGIN PRIVATE KEY-----\nMIIBogus\n-----END PRIVATE KEY-----\n',
    );
    const violations = checkForLeakedSecrets(repoRoot);
    expect(violations.some((v) => v.line === 2 && v.message.includes('PEM header'))).toBe(true);
  });

  it('fails on a high-entropy string that is not a secretRef:// URI', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'roles/p2p.yaml',
      'apiVersion: mcpforge/v1\nnote: kX9pL2vQzR7mN4wT8yB1cF6hJ3sA5uE0\n',
    );
    const violations = checkForLeakedSecrets(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(2);
    expect(violations[0]!.message).toContain('high-entropy');
  });

  it('does not flag a secretRef:// URI even though it is a long, varied string', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'packages/jde-fin.yaml',
      'apiVersion: mcpforge/v1\nsecretRef: secretRef://binding/ebs-p2p-ap/wrapper-schema-credential\n',
    );
    expect(checkForLeakedSecrets(repoRoot)).toEqual([]);
  });

  it('does not flag a low-entropy divider line or ordinary prose', () => {
    repoRoot = makeRepoRoot();
    writeFile(
      repoRoot,
      'manifests/README.md',
      '------------------------------------------------------------------\nThis is an ordinary sentence about JD Edwards vouchers and approvals.\n',
    );
    expect(checkForLeakedSecrets(repoRoot)).toEqual([]);
  });

  it('does not scan outside the five named roots', () => {
    repoRoot = makeRepoRoot();
    writeFile(repoRoot, 'generated/tools/whatever/config.yaml', 'password: hunter2\n');
    expect(checkForLeakedSecrets(repoRoot)).toEqual([]);
  });
});

describe('runOverlayPurityCheck', () => {
  it('is ok on an empty repo (no overlays/, no other scanned roots)', () => {
    repoRoot = makeRepoRoot();
    const report = runOverlayPurityCheck(repoRoot);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('combines both scans and is not ok when either finds a violation', () => {
    repoRoot = makeRepoRoot();
    writeFile(repoRoot, 'overlays/acme/hack.js', 'module.exports = 1;\n');
    writeFile(repoRoot, 'roles/p2p.yaml', 'apiVersion: mcpforge/v1\npassword: hunter2\n');
    const report = runOverlayPurityCheck(repoRoot);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(2);
  });
});
