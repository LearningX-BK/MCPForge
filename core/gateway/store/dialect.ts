// MCPForge — the driver boundary. This is the ONLY file in the repository that
// opens a database connection, and `better-sqlite3` and `pg` are imported here
// and nowhere else. 02 §10.2: "Both sit under the repository interface; **no
// application code imports either directly**, and that is enforced by an
// ESLint `no-restricted-imports` rule" — the root `eslint.config.js` carries
// that rule, with `core/gateway/store/**` as its single exemption.
//
// Above this file nothing knows which dialect is in use. That is the whole
// point: moving to Postgres is "a driver, connection-string and migration-set
// change, not a rewrite".

import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SQL } from 'drizzle-orm';
import { DEFAULT_SQLITE_PATH, type StoreConfig, type StoreKind } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where `drizzle-kit generate` writes each dialect's migration set. */
export const MIGRATIONS_DIR: Readonly<Record<StoreKind, string>> = {
  sqlite: join(HERE, 'migrations', 'sqlite'),
  postgres: join(HERE, 'migrations', 'postgres'),
};

/**
 * The narrow execution surface the repositories are allowed to use. Both
 * dialects compile the same drizzle `sql` template — which is what keeps the
 * SQL legible in review (02 §10.2: "SQL-shaped, not SQL-hiding"; the audit path
 * is a governance surface, not just a data-access layer) while the placeholder
 * syntax difference stays inside drizzle.
 */
export interface DialectConnection {
  readonly kind: StoreKind;
  /** Rows for a SELECT. */
  all<Row extends Record<string, unknown>>(query: SQL): Promise<Row[]>;
  /** A statement with no row result. */
  run(query: SQL): Promise<void>;
  /**
   * Run every statement inside one transaction.
   *
   * **Reentrant.** A `transaction()` call made while a transaction is already
   * open on this connection JOINS the open one as a savepoint rather than
   * starting a second, independent one — see `savepointingTransaction` below
   * for why that is a correctness requirement and not a convenience.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /**
   * How many transaction scopes the CALLING async chain has open: 0 outside one
   * — including while an unrelated chain holds one — 1 inside the outermost,
   * 2+ inside a savepoint. Exposed for the tests that prove the nesting
   * behaviour; repositories must not branch on it.
   */
  readonly transactionDepth: () => number;
  /** Apply this dialect's generated migration set. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * 02 §10.4 item 7, verbatim on the pragmas: `journal_mode=WAL`,
 * `busy_timeout=5000`, `synchronous=NORMAL`. SQLite serialises writers; at
 * Wave 0's traffic — one developer, a benchmark harness, a probe run, a demo —
 * that is not a constraint.
 */
export const SQLITE_PRAGMAS: readonly string[] = [
  'journal_mode = WAL',
  'busy_timeout = 5000',
  'synchronous = NORMAL',
  // Not from §10.4: without this SQLite silently ignores REFERENCES clauses,
  // which would make the two dialects disagree about referential integrity the
  // moment W0-C2's satellites arrive.
  'foreign_keys = ON',
];

/**
 * The scope a transaction runs in, carried down the async call chain rather
 * than held in a bare counter.
 *
 * **Why an `AsyncLocalStorage` and not a number.** A counter cannot tell
 * "`transaction()` called *inside* an open transaction" from "`transaction()`
 * called *concurrently with* one" — both see a non-zero count — and the two
 * must behave in opposite ways: the first has to join the open scope, the
 * second must not, because joining would fold two unrelated units of work into
 * one, and then one caller's rollback would silently discard the other's
 * committed-looking writes. `AsyncLocalStorage` distinguishes them exactly:
 * only work spawned inside the transaction's own callback sees the scope.
 */
interface TransactionScope {
  depth: number;
}

/**
 * The reentrant transaction scope, written once and shared by both dialects.
 *
 * **Why this exists (W0-C3).** The write path composes: consuming a confirm
 * nonce, writing the idempotency record, invoking the binding and appending the
 * audit row have to be ONE atomic unit, and each of those steps is a repository
 * method that quite reasonably wants a transaction of its own. Before this,
 * `transaction()` unconditionally issued `BEGIN`, so an inner call raised
 * *"cannot start a transaction within a transaction"* on SQLite — which meant
 * the only way to compose the write path was for the outermost caller to open
 * the transaction and every inner repository to run bare. That is exactly the
 * arrangement in which a step silently ends up outside the unit, and 02 §3.1.1
 * requires the nonce-consuming `INSERT` to be *inside the same transaction as
 * the execute*. So nesting is made correct here rather than avoided everywhere.
 *
 * The semantics, which are the ordinary savepoint semantics and are the same on
 * both engines:
 *  - depth 0 → `BEGIN` … `COMMIT` / `ROLLBACK`. One unit, one durable commit.
 *  - depth ≥ 1 → `SAVEPOINT sp_n` … `RELEASE sp_n` / `ROLLBACK TO sp_n` then
 *    `RELEASE sp_n`. **Releasing a savepoint commits nothing** — the work
 *    becomes durable only when the outermost scope commits, which is what makes
 *    an inner `transaction()` join the outer one instead of escaping it. An
 *    inner failure that the caller catches undoes only the inner work; an inner
 *    failure that propagates unwinds every enclosing scope in turn and the
 *    outermost `ROLLBACK` discards the lot.
 *
 * A rollback that itself fails must never replace the error that caused it —
 * the original is what names the actual fault — so the unwind is best-effort
 * and the original error is always the one rethrown.
 *
 * **Concurrent, unrelated transactions are serialised, not interleaved.** There
 * is one connection — `better-sqlite3` is a single synchronous handle and
 * `openPostgres` deliberately opens one client rather than a pool — and one
 * connection has one transaction. So a `transaction()` call that is NOT inside
 * an open scope on its own async chain waits for the open one to finish before
 * issuing its `BEGIN`. Without that queue, two concurrent callers would fold
 * into one unit and one caller's rollback would discard the other's work; with
 * it, "a concurrent second attempt loses deterministically" is a property of
 * the store rather than of the scheduler. Note this is *not* what makes a nonce
 * single-use — the `UNIQUE` constraint is (02 §3.1.1) — it is what makes the
 * losing attempt fail on that constraint instead of on transaction bookkeeping.
 *
 * **Single-connection, single-instance, stated rather than assumed.** All of
 * the above is only sound because the Wave 0 gateway runs as ONE instance
 * against a single-writer, single-host SQLite store (02 §10.4 item 6).
 * Multi-replica is a Postgres-era property. A pooled Postgres driver would have
 * to bind a scope to a checked-out client instead of to a connection-wide
 * queue, and cross-replica ordering would come from the database's own locking
 * rather than from anything in this file.
 */
function savepointingTransaction(
  exec: (statement: string) => Promise<void>,
  scopes: AsyncLocalStorage<TransactionScope>,
  queue: { tail: Promise<unknown> },
): <T>(work: () => Promise<T>) => Promise<T> {
  async function run<T>(scope: TransactionScope, work: () => Promise<T>): Promise<T> {
    const nested = scope.depth > 0;
    // Named by depth, so nesting is legible in a query log and an inner scope
    // can never release an outer one's savepoint.
    const savepoint = `mcpforge_sp_${scope.depth}`;
    await exec(nested ? `savepoint ${savepoint}` : 'begin');
    scope.depth += 1;
    try {
      const result = await scopes.run(scope, work);
      await exec(nested ? `release savepoint ${savepoint}` : 'commit');
      return result;
    } catch (error) {
      try {
        await exec(nested ? `rollback to savepoint ${savepoint}` : 'rollback');
        if (nested) {
          await exec(`release savepoint ${savepoint}`);
        }
      } catch {
        // Deliberately swallowed: see above. The original error is rethrown.
      }
      throw error;
    } finally {
      scope.depth -= 1;
    }
  }

  return <T>(work: () => Promise<T>): Promise<T> => {
    const open = scopes.getStore();
    if (open !== undefined) {
      // Inside this chain's own transaction: join it as a savepoint, and do NOT
      // queue — queueing behind the transaction we are already inside of would
      // deadlock.
      return run(open, work);
    }
    // A new outermost unit. It waits its turn: `.then(next, next)` runs it
    // whether the previous unit committed or rolled back, so one failure does
    // not strand the queue.
    const next = (): Promise<T> => run({ depth: 0 }, work);
    const started = queue.tail.then(next, next);
    queue.tail = started.then(
      () => undefined,
      () => undefined,
    );
    return started;
  };
}

async function openSqlite(file: string): Promise<DialectConnection> {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  for (const pragma of SQLITE_PRAGMAS) {
    sqlite.pragma(pragma);
  }
  const db = drizzle(sqlite);
  const scopes = new AsyncLocalStorage<TransactionScope>();
  const queue = { tail: Promise.resolve<unknown>(undefined) };

  return {
    kind: 'sqlite',
    transactionDepth: () => scopes.getStore()?.depth ?? 0,
    all: <Row extends Record<string, unknown>>(query: SQL) =>
      Promise.resolve(db.all(query) as Row[]),
    run: (query: SQL) => {
      db.run(query);
      return Promise.resolve();
    },
    // better-sqlite3 is synchronous, so a `BEGIN`/`COMMIT` pair around awaited
    // work is safe here in a way it would not be on an async pooled driver:
    // there is one connection and no interleaving. When Postgres arrives the
    // pg branch below is the one that owns real transaction scoping. Nesting is
    // savepoint-based on both — see `savepointingTransaction`.
    transaction: savepointingTransaction(
      (statement) => {
        sqlite.exec(statement);
        return Promise.resolve();
      },
      scopes,
      queue,
    ),
    migrate: () => {
      migrate(db, { migrationsFolder: MIGRATIONS_DIR.sqlite });
      return Promise.resolve();
    },
    close: () => {
      sqlite.close();
      return Promise.resolve();
    },
  };
}

async function openPostgres(connectionString: string): Promise<DialectConnection> {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  // One client, not a pool: the Wave 0 gateway is one instance (02 §10.4
  // item 6) and a single session keeps transaction scoping honest.
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = drizzle(client);
  const scopes = new AsyncLocalStorage<TransactionScope>();
  const queue = { tail: Promise.resolve<unknown>(undefined) };

  return {
    kind: 'postgres',
    transactionDepth: () => scopes.getStore()?.depth ?? 0,
    all: async <Row extends Record<string, unknown>>(query: SQL) => {
      const result = await db.execute(query);
      return result.rows as Row[];
    },
    run: async (query: SQL) => {
      await db.execute(query);
    },
    // Postgres spells savepoints identically to SQLite, so the one
    // implementation serves both. It matters more here than on SQLite: an error
    // inside a Postgres transaction poisons the whole transaction until it is
    // rolled back, so without a savepoint an expected, handled failure — a
    // nonce that is already consumed, an idempotency key that already exists —
    // would abort the entire write unit instead of being classified.
    transaction: savepointingTransaction(
      async (statement) => {
        await client.query(statement);
      },
      scopes,
      queue,
    ),
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_DIR.postgres }),
    close: () => client.end(),
  };
}

export function openConnection(config: StoreConfig): Promise<DialectConnection> {
  return config.kind === 'sqlite'
    ? openSqlite(config.file ?? DEFAULT_SQLITE_PATH)
    : openPostgres(config.connectionString);
}
