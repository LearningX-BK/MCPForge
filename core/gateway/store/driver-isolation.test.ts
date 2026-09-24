// MCPForge — proof of the W0-C1 done criterion's third clause: "no application
// file outside `core/gateway/store/` imports a driver directly (proved by the
// `W0-A2` lint rule)".
//
// The lint rule is the enforcement. This test is the second lock: it scans the
// repository's own TypeScript for driver imports, and it asserts that the lint
// rule's exemption is still exactly one directory wide — because a widened
// exemption would silently disarm the rule while leaving it green.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STORE_DIR = join(REPO_ROOT, 'core', 'gateway', 'store');
const DRIVERS = ['better-sqlite3', 'pg'] as const;
const SKIP = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'generated',
  '.git',
  '.forge-build',
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function importsDriver(source: string, driver: string): boolean {
  const quoted = `['"\`]${driver}(/[^'"\`]*)?['"\`]`;
  return (
    new RegExp(`\\bfrom\\s+${quoted}`).test(source) ||
    new RegExp(`\\bimport\\s*\\(\\s*${quoted}`).test(source) ||
    new RegExp(`\\brequire\\s*\\(\\s*${quoted}`).test(source)
  );
}

describe('driver isolation (02 §10.2)', () => {
  const files = sourceFiles(REPO_ROOT);

  it('finds the repository source at all — a silent empty scan would prove nothing', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const driver of DRIVERS) {
    it(`${driver} is imported only under the store`, () => {
      const offenders = files
        .filter((f) => !f.startsWith(STORE_DIR))
        .filter((f) => importsDriver(readFileSync(f, 'utf8'), driver))
        .map((f) => relative(REPO_ROOT, f).split(sep).join('/'));
      expect(offenders).toEqual([]);
    });
  }

  it('only the connection module reaches a driver, even inside the store', () => {
    // Test files are excluded: `dialect.test.ts` opens a second raw connection
    // deliberately, to prove the pragmas landed on the file.
    const inside = sourceFiles(STORE_DIR)
      .filter((f) => !/\.(test|spec)\.ts$/.test(f))
      .filter((f) => DRIVERS.some((d) => importsDriver(readFileSync(f, 'utf8'), d)));
    expect(inside.map((f) => relative(STORE_DIR, f).split(sep).join('/'))).toEqual(['dialect.ts']);
  });

  it('every store operation is reachable only through the repository interface', async () => {
    // The public surface must not hand out a connection, a driver handle or a
    // way to execute SQL — that would be a route around `RuntimeStore`.
    //
    // `openRuntimeStore` itself moved off `./index.js` onto `./server.js`
    // (this task): `index.js` is the barrel a portal `'use client'` component
    // reaches via `@mcpforge/gateway/store`, and `openRuntimeStore` pulls in
    // `./store.js` -> `./dialect.js`, the one file that touches the native
    // `better-sqlite3`/`pg` drivers — exactly what this test's OWN next
    // assertion (client bundle safety is `store.contract.test.ts`'s concern,
    // not this file's) would call an escape if it stayed reachable from a
    // client-safe barrel. `server.js` — `export * from './index.js'` plus
    // `openRuntimeStore` and the other server-only pieces — is now the
    // "repository interface" this test's name refers to for anything that
    // actually opens a store.
    const surface = (await import('./index.js')) as Record<string, unknown>;
    const CONSTANTS = new Set(['DEFAULT_SQLITE_PATH']);
    const escapes = Object.keys(surface)
      .filter((name) => !CONSTANTS.has(name))
      .filter((name) => /connection|dialect|driver|database|sql|migrat|raw|query|exec/i.test(name));
    expect(escapes).toEqual([]);
    expect(Object.keys(surface)).not.toContain('openRuntimeStore');

    const serverSurface = (await import('./server.js')) as Record<string, unknown>;
    const serverEscapes = Object.keys(serverSurface)
      .filter((name) => !CONSTANTS.has(name) && name !== 'openRuntimeStore')
      .filter((name) => /connection|dialect|driver|database|sql|migrat|raw|query|exec/i.test(name));
    expect(serverEscapes).toEqual([]);
    expect(Object.keys(serverSurface)).toContain('openRuntimeStore');

    const store = await import('./store.js');
    const opened = await store.openRuntimeStore({ kind: 'sqlite', file: ':memory:' });
    expect(Object.keys(opened).sort()).toEqual([
      // W0-C3 added `approvals`, `idempotency` and `nonces`. The list is
      // exhaustive on purpose: a property added to `RuntimeStore` that handed
      // out a connection, a driver handle or a SQL string would fail here.
      // W0-N8. The `anomaly_event` trail. Append, read and one triage
      // transition — no connection, no driver handle, no SQL.
      'anomalies',
      'approvals',
      'audit',
      'close',
      // W0-N10. The `consumption_edge` feed (02 §4.6) — a repository like the
      // others, hands out no connection, no driver handle and no SQL.
      'consumption',
      'descriptor',
      'heartbeats',
      'idempotency',
      'kind',
      // W0-D2. `localUsers` is the one repository that can return credential
      // material, and it does so through a single method (`findCredential`)
      // returning a single type. It still hands out no connection, no driver
      // handle and no SQL.
      'localUsers',
      'migrate',
      'nonces',
      // W0-C4. `retention` is the one gated deletion path (02 §4.6's "single
      // exception to append-only"). It is a repository like the others — it
      // hands out no connection, no driver handle and no SQL.
      'retention',
      // W0-E5. The kill switch's persistence. A repository like the others —
      // it hands out no connection, no driver handle and no SQL.
      'runtimeFlags',
      'transaction',
      // W0-N7. Consumer usage rollups (02 §11.6) — a repository like the
      // others, hands out no connection, no driver handle and no SQL.
      'usage',
    ]);
    await opened.close();
  });

  it('the lint rule still restricts both drivers and exempts only the store', () => {
    const config = readFileSync(join(REPO_ROOT, 'eslint.config.js'), 'utf8');
    for (const driver of DRIVERS) {
      expect(config).toContain(`name: '${driver}'`);
    }
    expect(config).toContain("files: ['core/gateway/store/**/*.{ts,tsx}']");
  });
});
