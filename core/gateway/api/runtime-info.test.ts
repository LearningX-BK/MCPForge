// MCPForge — proof of the W0-C1 done criterion's fourth clause:
// "`runtime.store.kind` is exposed on the gateway API for the portal's
// data-class chip" (02 §10.5, 03 §11.2).

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store/server.js';
import type { RuntimeStore } from '../store/server.js';
import { runtimeInfo } from './runtime-info.js';

const opened: RuntimeStore[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

async function sqliteStore(): Promise<RuntimeStore> {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-runtime-info-'));
  dirs.push(dir);
  const store = await openRuntimeStore({ kind: 'sqlite', file: join(dir, 'runtime.db') });
  opened.push(store);
  return store;
}

describe('runtime info', () => {
  it('exposes store.kind for the data-class chip', async () => {
    const info = runtimeInfo(await sqliteStore());
    expect(info.store.kind).toBe('sqlite');
    expect(info.store.label).toBe('SQLite · local file');
  });

  it('tells the truth about ephemerality — the audit trail starts empty on a fresh checkout', async () => {
    const info = runtimeInfo(await sqliteStore());
    expect(info.store.ephemeral).toBe(true);
    expect(info.store.note).toContain('start empty on a fresh checkout');
  });

  it('states that Wave 0 runs as one instance — multi-replica is a Postgres-era property', async () => {
    expect(runtimeInfo(await sqliteStore()).singleInstance).toBe(true);
  });

  it('never puts a Postgres connection string in the payload', async () => {
    const store = await sqliteStore();
    const postgresShaped: RuntimeStore = {
      ...store,
      kind: 'postgres',
      descriptor: {
        kind: 'postgres',
        label: 'PostgreSQL · server',
        location: 'configured connection',
        ephemeral: false,
      },
    };
    const info = runtimeInfo(postgresShaped);
    expect(info.store.kind).toBe('postgres');
    expect(JSON.stringify(info)).not.toContain('postgres://');
    expect(JSON.stringify(info)).not.toContain('password');
  });
});
