// MCPForge — group-role-mapping.ts, W0-D4.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findMappingFiles,
  loadMappingFiles,
  parseGroupRoleMappingFile,
  remapSubjectAcrossMappingFiles,
} from './group-role-mapping.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mcpforge-mappings-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMapping(deployment: string, body: string): string {
  const dir = path.join(root, deployment, 'mappings');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'groups-to-roles.yaml');
  writeFileSync(file, body, 'utf-8');
  return file;
}

const LOCAL_ONLY = `
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

const AD_ONLY = `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  "CN=Finance-AP,OU=Groups,DC=corp,DC=example,DC=com":
    roles: [p2p-ap-clerk, p2p-ap-approver]
`;

describe('parseGroupRoleMappingFile', () => {
  it('accepts a local group name and an AD group DN identically — same key, same shape', () => {
    const local = parseGroupRoleMappingFile('local.yaml', LOCAL_ONLY);
    const ad = parseGroupRoleMappingFile('ad.yaml', AD_ONLY);
    expect(local.ok).toBe(true);
    expect(ad.ok).toBe(true);
    if (!local.ok || !ad.ok) return;
    expect(local.doc.groups['finance-ap-clerks']).toEqual({ roles: ['p2p-ap-clerk'] });
    expect(ad.doc.groups['CN=Finance-AP,OU=Groups,DC=corp,DC=example,DC=com']).toEqual({
      roles: ['p2p-ap-clerk', 'p2p-ap-approver'],
    });
  });

  it('rejects a wrong apiVersion with a specific message, not a throw', () => {
    const result = parseGroupRoleMappingFile(
      'bad.yaml',
      'apiVersion: v2\nkind: GroupRoleMapping\ndeployment: local\ngroups: {}\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('apiVersion');
  });

  it('rejects malformed YAML without throwing', () => {
    const result = parseGroupRoleMappingFile('bad.yaml', '{ not: valid: yaml');
    expect(result.ok).toBe(false);
  });

  it('rejects a groups entry missing roles', () => {
    const result = parseGroupRoleMappingFile(
      'bad.yaml',
      'apiVersion: mcpforge/v1\nkind: GroupRoleMapping\ndeployment: local\ngroups:\n  g1: {}\n',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('groups');
  });
});

describe('findMappingFiles / loadMappingFiles', () => {
  it('finds mapping files nested under any */mappings/ directory', () => {
    const f1 = writeMapping('local', LOCAL_ONLY);
    const f2 = writeMapping('jde-fin', AD_ONLY);
    const found = findMappingFiles(root);
    expect(found.sort()).toEqual([f1, f2].sort());
  });

  it('ignores non-mapping yaml files and files outside a mappings/ dir', () => {
    mkdirSync(path.join(root, 'local', 'other'), { recursive: true });
    writeFileSync(path.join(root, 'local', 'other', 'groups-to-roles.yaml'), LOCAL_ONLY, 'utf-8');
    expect(findMappingFiles(root)).toEqual([]);
  });

  it('loads valid files and reports parse errors for broken ones separately', () => {
    writeMapping('local', LOCAL_ONLY);
    writeMapping('broken', '{ not valid');
    const { loaded, errors } = loadMappingFiles(root);
    expect(loaded).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('remapSubjectAcrossMappingFiles', () => {
  it('rewrites a subjectOverrides key across every mapping file that has it, and reports every changed row', () => {
    const f1 = writeMapping('local', LOCAL_ONLY);
    const f2 = writeMapping('jde-fin', AD_ONLY); // no subjectOverrides at all — must be left untouched

    const before2 = readFileSync(f2, 'utf-8');
    const { changed, errors } = remapSubjectAcrossMappingFiles(
      root,
      'local:jdoe',
      'oidc:jane.doe@corp.example.com',
    );

    expect(errors).toEqual([]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      filePath: f1,
      fromSubject: 'local:jdoe',
      toSubject: 'oidc:jane.doe@corp.example.com',
      roles: ['p2p-admin'],
      mergedWithExisting: false,
    });

    const after1 = readFileSync(f1, 'utf-8');
    expect(after1).not.toContain('local:jdoe');
    expect(after1).toContain('jane.doe@corp.example.com');

    // untouched file is byte-identical — no spurious diff
    expect(readFileSync(f2, 'utf-8')).toBe(before2);
  });

  it('merges into an existing target-subject entry rather than clobbering it', () => {
    const f1 = writeMapping(
      'local',
      `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups: {}
subjectOverrides:
  local:jdoe:
    roles: [p2p-admin]
  oidc:jane.doe:
    roles: [p2p-ap-approver]
`,
    );

    const { changed } = remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jane.doe');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.mergedWithExisting).toBe(true);
    expect(changed[0]?.roles).toEqual(['p2p-admin', 'p2p-ap-approver']);

    const after = readFileSync(f1, 'utf-8');
    expect(after).not.toContain('local:jdoe');
  });

  it('reports zero changed rows, not an error, when the subject is nowhere in any mapping file', () => {
    writeMapping('local', LOCAL_ONLY);
    const { changed, errors } = remapSubjectAcrossMappingFiles(root, 'local:nobody', 'oidc:nobody');
    expect(changed).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('skips a broken file but still remaps the ones that parse', () => {
    const f1 = writeMapping('local', LOCAL_ONLY);
    writeMapping('broken', '{ not valid');
    const { changed, errors } = remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    expect(changed).toHaveLength(1);
    expect(changed[0]?.filePath).toBe(f1);
    expect(errors).toHaveLength(1);
  });
});
