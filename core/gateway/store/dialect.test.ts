// MCPForge — 02 §10.4 item 7 names three pragmas and this test holds them:
// `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`.

import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLITE_PRAGMAS } from './dialect.js';
import { openRuntimeStore } from './store.js';

const dir = mkdtempSync(join(tmpdir(), 'mcpforge-pragma-'));
const file = join(dir, 'runtime.db');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('SQLite connection setup', () => {
  it('sets the three pragmas 02 §10.4 item 7 names', () => {
    expect(SQLITE_PRAGMAS).toContain('journal_mode = WAL');
    expect(SQLITE_PRAGMAS).toContain('busy_timeout = 5000');
    expect(SQLITE_PRAGMAS).toContain('synchronous = NORMAL');
  });

  it('actually applies them to the opened database file', async () => {
    const store = await openRuntimeStore({ kind: 'sqlite', file });
    await store.heartbeats.record({ instanceId: 'pragma-check' });
    await store.close();

    // WAL is recorded in the file header, so a second connection sees it.
    const raw = new Database(file);
    try {
      expect(String(raw.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
    } finally {
      raw.close();
    }
  });

  it('creates the parent directory — ./.mcpforge/ need not exist on a clean clone', async () => {
    const nested = join(dir, 'nested', 'deeper', 'runtime.db');
    const store = await openRuntimeStore({ kind: 'sqlite', file: nested });
    expect(store.kind).toBe('sqlite');
    await store.close();
  });
});
