// MCPForge — group-role-mapping.ts, W0-D4.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findMappingFiles,
  identityAdminGroups,
  isIdentityAdmin,
  isSuperAdmin,
  superAdminGroups,
  loadMappingFiles,
  parseGroupRoleMappingFile,
  personasForPrincipal,
  remapSubjectAcrossMappingFiles,
  rolesForPrincipal,
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

  it('W0-P22: reads superAdminSubjects as a sorted subject list and rejects a malformed one', () => {
    const ok = parseGroupRoleMappingFile(
      'ok.yaml',
      `${LOCAL_ONLY}superAdminSubjects: [local:b, local:a, local:a]\n`,
    );
    expect(ok.ok && ok.doc.superAdminSubjects).toEqual(['local:a', 'local:b']);
    const bad = parseGroupRoleMappingFile('bad.yaml', `${LOCAL_ONLY}superAdminSubjects: local:a\n`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.message).toContain('superAdminSubjects');
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

  // W0-P22 — superAdminSubjects holds subject values, so a remap rewrites it;
  // missing it would silently take the super admin's self-approval away.
  it('rewrites a superAdminSubjects entry, even in a file with no subjectOverrides', () => {
    const f1 = writeMapping(
      'local',
      `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  mcpforge-superadmins:
    roles: [super-admin]
superAdmins: [mcpforge-superadmins]
superAdminSubjects: [local:jdoe, local:other]
`,
    );
    const { changed, errors } = remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    expect(errors).toEqual([]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      filePath: f1,
      roles: [],
      mergedWithExisting: false,
      superAdminSubjectRewritten: true,
    });
    const reparsed = parseGroupRoleMappingFile(f1, readFileSync(f1, 'utf-8'));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.doc.superAdminSubjects).toEqual(['local:other', 'oidc:jdoe']);
    expect(reparsed.doc.superAdmins).toEqual(['mcpforge-superadmins']);
    expect(reparsed.doc.subjectOverrides).toBeUndefined();
  });

  it('keeps superAdminSubjects on a remap of a subjectOverrides entry for someone else', () => {
    const f1 = writeMapping('local', `${LOCAL_ONLY}superAdminSubjects: [local:boss]\n`);
    const { changed } = remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    expect(changed[0]?.superAdminSubjectRewritten).toBe(false);
    const reparsed = parseGroupRoleMappingFile(f1, readFileSync(f1, 'utf-8'));
    expect(reparsed.ok && reparsed.doc.superAdminSubjects).toEqual(['local:boss']);
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

describe('personas (W0-P5b) -- a lens from the git mapping, never a grant', () => {
  const WITH_PERSONAS = `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  finance-ap-clerks:
    roles: [p2p-ap-clerk]
  mcpforge-admins:
    roles: [p2p-admin]
subjectOverrides:
  local:jdoe:
    roles: [p2p-ap-approver]
personas:
  mcpforge-admins:
    personas: [admin, developer]
  finance-ap-clerks:
    personas: [business]
`;

  it('parses the personas block keyed by group', () => {
    const result = parseGroupRoleMappingFile('x.yaml', WITH_PERSONAS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.personas).toEqual({
      'mcpforge-admins': { personas: ['admin', 'developer'] },
      'finance-ap-clerks': { personas: ['business'] },
    });
  });

  it('refuses a persona outside the closed set', () => {
    const result = parseGroupRoleMappingFile(
      'x.yaml',
      WITH_PERSONAS.replace('[business]', '[business, superuser]'),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/personas: .*superuser/);
  });

  it('resolves the union over groups, in PERSONAS order; an unmapped group offers none', () => {
    const result = parseGroupRoleMappingFile('x.yaml', WITH_PERSONAS);
    if (!result.ok) throw new Error('fixture must parse');
    expect(
      personasForPrincipal([result.doc], { groups: ['finance-ap-clerks', 'mcpforge-admins'] }),
    ).toEqual(['developer', 'business', 'admin']);
    expect(personasForPrincipal([result.doc], { groups: ['nobody-maps-this'] })).toEqual([]);
    expect(personasForPrincipal([result.doc], { groups: ['__proto__', 'constructor'] })).toEqual(
      [],
    );
  });

  it('personas never change the roles a principal holds', () => {
    const withBlock = parseGroupRoleMappingFile('x.yaml', WITH_PERSONAS);
    const without = parseGroupRoleMappingFile(
      'x.yaml',
      WITH_PERSONAS.slice(0, WITH_PERSONAS.indexOf('personas:')),
    );
    if (!withBlock.ok || !without.ok) throw new Error('fixtures must parse');
    for (const principal of [
      { subject: 'local:a', groups: ['mcpforge-admins'] },
      { subject: 'local:jdoe', groups: ['finance-ap-clerks'] },
      { subject: 'local:b', groups: [] },
    ]) {
      expect(rolesForPrincipal([withBlock.doc], principal)).toEqual(
        rolesForPrincipal([without.doc], principal),
      );
    }
  });

  it('a subject remap keeps the personas block', () => {
    const file = writeMapping('local', WITH_PERSONAS);
    remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    const reparsed = parseGroupRoleMappingFile(file, readFileSync(file, 'utf-8'));
    expect(reparsed.ok && reparsed.doc.personas?.['mcpforge-admins']?.personas).toEqual([
      'admin',
      'developer',
    ]);
  });
});

describe('identityAdmins (W0-P28) -- who may administer local users, from git', () => {
  const WITH_ADMINS = `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  mcpforge-admins:
    roles: [p2p-admin]
  finance-ap-clerks:
    roles: [p2p-ap-clerk]
subjectOverrides:
  local:jdoe:
    roles: [p2p-ap-approver]
identityAdmins:
  - mcpforge-admins
  - mcpforge-admins
`;

  it('parses the list, de-duplicated and sorted', () => {
    const result = parseGroupRoleMappingFile('x.yaml', WITH_ADMINS);
    expect(result.ok && result.doc.identityAdmins).toEqual(['mcpforge-admins']);
  });

  it('refuses a list that is not of non-empty group names', () => {
    for (const bad of [
      'identityAdmins: mcpforge-admins',
      "identityAdmins: ['']",
      'identityAdmins: [1]',
    ]) {
      const result = parseGroupRoleMappingFile(
        'x.yaml',
        WITH_ADMINS.replace(/identityAdmins:[\s\S]*$/, bad),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toMatch(/identityAdmins/);
    }
  });

  it('is empty when absent, so nobody may administer (fail closed)', () => {
    const result = parseGroupRoleMappingFile('x.yaml', LOCAL_ONLY);
    if (!result.ok) throw new Error('fixture must parse');
    expect(identityAdminGroups([result.doc])).toEqual([]);
    expect(isIdentityAdmin([result.doc], ['finance-ap-clerks'])).toBe(false);
  });

  it('answers by group membership only, and grants no role', () => {
    const result = parseGroupRoleMappingFile('x.yaml', WITH_ADMINS);
    if (!result.ok) throw new Error('fixture must parse');
    expect(isIdentityAdmin([result.doc], ['mcpforge-admins'])).toBe(true);
    expect(isIdentityAdmin([result.doc], ['finance-ap-clerks', '__proto__'])).toBe(false);
    const without = parseGroupRoleMappingFile(
      'x.yaml',
      WITH_ADMINS.slice(0, WITH_ADMINS.indexOf('identityAdmins:')),
    );
    if (!without.ok) throw new Error('fixture must parse');
    const principal = { subject: 'local:a', groups: ['mcpforge-admins'] };
    expect(rolesForPrincipal([result.doc], principal)).toEqual(
      rolesForPrincipal([without.doc], principal),
    );
  });

  it('a subject remap keeps the identityAdmins list', () => {
    const file = writeMapping('local', WITH_ADMINS);
    remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    const reparsed = parseGroupRoleMappingFile(file, readFileSync(file, 'utf-8'));
    expect(reparsed.ok && reparsed.doc.identityAdmins).toEqual(['mcpforge-admins']);
  });
});

describe('superAdmins (W0-P31) -- the super-admin groups, from git', () => {
  const WITH_SUPER = `
apiVersion: mcpforge/v1
kind: GroupRoleMapping
deployment: local
groups:
  mcpforge-superadmins:
    roles: [super-admin]
superAdmins:
  - mcpforge-superadmins
`;

  it('parses the list and answers by group membership only', () => {
    const result = parseGroupRoleMappingFile('x.yaml', WITH_SUPER);
    if (!result.ok) throw new Error('fixture must parse');
    expect(superAdminGroups([result.doc])).toEqual(['mcpforge-superadmins']);
    expect(isSuperAdmin([result.doc], ['mcpforge-superadmins'])).toBe(true);
    expect(isSuperAdmin([result.doc], ['finance-ap-clerks', '__proto__'])).toBe(false);
  });

  it('refuses a malformed list and is empty when absent (fail closed)', () => {
    const bad = parseGroupRoleMappingFile(
      'x.yaml',
      WITH_SUPER.replace(/superAdmins:[\s\S]*$/, 'superAdmins: yes'),
    );
    expect(bad.ok).toBe(false);
    const none = parseGroupRoleMappingFile('x.yaml', LOCAL_ONLY);
    if (!none.ok) throw new Error('fixture must parse');
    expect(superAdminGroups([none.doc])).toEqual([]);
  });

  it('a subject remap keeps the superAdmins list', () => {
    const file = writeMapping(
      'local',
      `${WITH_SUPER}subjectOverrides:\n  local:jdoe:\n    roles: [p2p]\n`,
    );
    remapSubjectAcrossMappingFiles(root, 'local:jdoe', 'oidc:jdoe');
    const reparsed = parseGroupRoleMappingFile(file, readFileSync(file, 'utf-8'));
    expect(reparsed.ok && reparsed.doc.superAdmins).toEqual(['mcpforge-superadmins']);
  });
});
