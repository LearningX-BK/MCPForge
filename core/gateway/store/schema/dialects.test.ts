// MCPForge — proof of the W0-C1 done criterion's first clause: "one schema
// definition emits migration sets for **both** SQLite and Postgres via
// `drizzle-kit`". These tests read the generated sets off disk and check them
// against the single definition in `spec.ts`, so a table added to one dialect
// by hand — or a regeneration of only one of the two — fails the build.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig as sqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { getTableConfig as pgTableConfig } from 'drizzle-orm/pg-core';
import { RUNTIME_TABLES, type TableSpec } from './spec.js';
import * as sqliteSchema from './sqlite.js';
import * as pgSchema from './pg.js';

/**
 * Every table in the single definition, paired with its two projections.
 *
 * Driven by `RUNTIME_TABLES` rather than a hand-written list: a table added to
 * `spec.ts` without an export in one of the projections fails here, which is
 * the drift this file exists to catch. W0-C2 added `audit_call` and its three
 * satellites plus `audit_retention_gate`, and they are covered by construction.
 */
const PROJECTED = Object.entries(RUNTIME_TABLES).map(([key, spec]: [string, TableSpec]) => {
  const sqliteTable = (sqliteSchema as Record<string, unknown>)[key];
  const pgTable = (pgSchema as Record<string, unknown>)[key];
  if (sqliteTable === undefined || pgTable === undefined) {
    throw new Error(`${spec.name} is in spec.ts but is not exported as "${key}" by both dialects.`);
  }
  return {
    key,
    spec,
    sqlite: sqliteTable as Parameters<typeof sqliteTableConfig>[0],
    pg: pgTable as Parameters<typeof pgTableConfig>[0],
  };
});

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function migrationSql(dialect: 'sqlite' | 'postgres'): string {
  const dir = join(MIGRATIONS, dialect);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

describe('one schema definition, two dialect projections', () => {
  it('projects every table in the definition into both dialects', () => {
    expect(PROJECTED.map((p) => p.key)).toEqual(Object.keys(RUNTIME_TABLES));
  });

  for (const { key, spec, sqlite, pg } of PROJECTED) {
    describe(key, () => {
      it('projects the same table and column names into both dialects', () => {
        const specCols = Object.keys(spec.columns).sort();
        expect(sqliteTableConfig(sqlite).name).toBe(spec.name);
        expect(pgTableConfig(pg).name).toBe(spec.name);
        expect(
          sqliteTableConfig(sqlite)
            .columns.map((c) => c.name)
            .sort(),
        ).toEqual(specCols);
        expect(
          pgTableConfig(pg)
            .columns.map((c) => c.name)
            .sort(),
        ).toEqual(specCols);
      });

      it('carries the spec indexes into both dialects', () => {
        const expected = (spec.indexes ?? []).map((i) => i.name);
        expect(sqliteTableConfig(sqlite).indexes.map((i) => i.config.name)).toEqual(expected);
        expect(pgTableConfig(pg).indexes.map((i) => i.config.name)).toEqual(expected);
      });

      it('agrees on which indexes are unique', () => {
        const expected = (spec.indexes ?? []).map((i) => i.unique === true);
        expect(sqliteTableConfig(sqlite).indexes.map((i) => i.config.unique === true)).toEqual(
          expected,
        );
        expect(pgTableConfig(pg).indexes.map((i) => i.config.unique === true)).toEqual(expected);
      });

      it('honours notNull and primaryKey identically in both dialects', () => {
        for (const [name, column] of Object.entries(spec.columns)) {
          const s = sqliteTableConfig(sqlite).columns.find((c) => c.name === name);
          const p = pgTableConfig(pg).columns.find((c) => c.name === name);
          const notNull = column.notNull === true || column.primaryKey === true;
          expect(s?.notNull ?? false).toBe(notNull);
          expect(p?.notNull ?? false).toBe(notNull);
          expect(s?.primary ?? false).toBe(column.primaryKey === true);
          expect(p?.primary ?? false).toBe(column.primaryKey === true);
        }
      });

      it('renders the same foreign keys in both dialects', () => {
        // W0-C2: the audit satellites reference audit_call.id. SQLite would
        // silently ignore the clause without `PRAGMA foreign_keys = ON`, which
        // dialect.ts sets — so the two dialects agree on referential integrity
        // rather than only appearing to.
        const expected = Object.entries(spec.columns)
          .filter(([, c]) => c.references !== undefined)
          .map(([name, c]) => `${name}->${c.references?.table}.${c.references?.column}`)
          .sort();
        const sqliteFks = sqliteTableConfig(sqlite)
          .foreignKeys.map((fk) => {
            const ref = fk.reference();
            return `${ref.columns[0]?.name}->${sqliteTableConfig(ref.foreignTable as Parameters<typeof sqliteTableConfig>[0]).name}.${ref.foreignColumns[0]?.name}`;
          })
          .sort();
        const pgFks = pgTableConfig(pg)
          .foreignKeys.map((fk) => {
            const ref = fk.reference();
            return `${ref.columns[0]?.name}->${pgTableConfig(ref.foreignTable as Parameters<typeof pgTableConfig>[0]).name}.${ref.foreignColumns[0]?.name}`;
          })
          .sort();
        expect(sqliteFks).toEqual(expected);
        expect(pgFks).toEqual(expected);
      });
    });
  }
});

describe('drizzle-kit emitted a migration set per dialect', () => {
  for (const dialect of ['sqlite', 'postgres'] as const) {
    it(`${dialect}: every table in the single definition appears in the generated DDL`, () => {
      const sql = migrationSql(dialect).toLowerCase();
      for (const table of Object.values(RUNTIME_TABLES)) {
        // SQLite quotes identifiers with backticks, Postgres with double quotes.
        const quoted = dialect === 'sqlite' ? `\`${table.name}\`` : `"${table.name}"`;
        expect(sql).toContain(`create table ${quoted}`.toLowerCase());
        for (const column of Object.keys(table.columns)) {
          expect(sql).toContain(column.toLowerCase());
        }
      }
    });

    it(`${dialect}: every index in the single definition appears in the generated DDL`, () => {
      const ddl = migrationSql(dialect).toLowerCase();
      for (const table of Object.values(RUNTIME_TABLES)) {
        for (const ix of table.indexes ?? []) {
          expect(ddl).toContain(ix.name.toLowerCase());
        }
      }
    });

    it(`${dialect}: has a journal entry, so the migrator can apply it`, () => {
      const journal = JSON.parse(
        readFileSync(join(MIGRATIONS, dialect, 'meta', '_journal.json'), 'utf8'),
      ) as { entries: unknown[] };
      expect(journal.entries.length).toBeGreaterThan(0);
    });
  }
});
