// MCPForge — `forge identity bootstrap-admin`, W0-P28.
//
// Driven in-process against a temporary repo root and an isolated SQLite
// store: it creates exactly one admin, records it as one `identity` audit row
// with no password, and then refuses — as it does under CI=true, without an
// identityAdmins group, and for a short password.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRuntimeStore } from '@mcpforge/gateway/store/server';
import { localUserStore } from '@mcpforge/gateway/identity';
import { BOOTSTRAP_TOOL_ID, runBootstrapAdminCommand } from './identity-bootstrap.js';

const PASSWORD = 'bootstrap-admin-passphrase-1';

let root: string;
let dbFile: string;
let out: string[];

function writeMapping(extra: string): void {
  const dir = path.join(root, 'overlays', 'local', 'mappings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'groups-to-roles.yaml'),
    `apiVersion: mcpforge/v1\nkind: GroupRoleMapping\ndeployment: local\ngroups:\n  local:\n    ops-admins:\n      roles: [p2p]\n${extra}`,
  );
}

function run(
  env: Record<string, string | undefined> = {},
  password = PASSWORD,
  username = 'first-admin',
) {
  return runBootstrapAdminCommand(
    { json: true, username, displayName: 'First Admin', root },
    {
      env: { ...env },
      openStore: () => openRuntimeStore({ kind: 'sqlite', file: dbFile }),
      readPassword: () => Promise.resolve(password),
    },
  );
}

function last(): {
  ok: boolean;
  code?: string;
  next: string;
  subject?: string;
  auditCallId?: string;
} {
  return JSON.parse(out[out.length - 1]!.trim()) as never;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mcpforge-bootstrap-admin-'));
  dbFile = path.join(root, 'runtime.db');
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('forge identity bootstrap-admin', () => {
  it('creates exactly one admin, audits it without the password, then refuses', async () => {
    writeMapping('identityAdmins:\n  local:\n    - ops-admins\n');
    expect(await run()).toBe(0);
    const report = last();
    expect(report.ok).toBe(true);

    const store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
    try {
      const user = await localUserStore({ store }).getUserByUsername('first-admin');
      expect(user?.groups).toEqual(['ops-admins']);
      const rows = await store.audit.listByResultKey('subject', user!.subject);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.phase).toBe('identity');
      expect(rows[0]!.toolId).toBe(BOOTSTRAP_TOOL_ID);
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    } finally {
      await store.close();
    }
    expect(out.join('')).not.toContain(PASSWORD);

    expect(await run({}, PASSWORD, 'second-admin')).toBe(1);
    expect(last().code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(last().next).toContain('portal');
  });

  it('refuses when CI=true, before touching the store', async () => {
    writeMapping('identityAdmins:\n  local:\n    - ops-admins\n');
    expect(await run({ CI: 'true' })).toBe(1);
    expect(last().code).toBe('POLICY_GUARDRAIL_BREACH');
  });

  it('refuses when the mapping names no identityAdmins group', async () => {
    writeMapping('');
    expect(await run()).toBe(1);
    expect(last().next).toContain('identityAdmins');
  });

  it('refuses a short password without echoing it', async () => {
    writeMapping('identityAdmins:\n  local:\n    - ops-admins\n');
    expect(await run({}, 'short-pw')).toBe(64);
    expect(out.join('')).not.toContain('short-pw');
  });
});
